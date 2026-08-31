import { PDFDocument } from '@cantoo/pdf-lib'
import { openForRender } from './pdfjs'
import { renderPage, scaleForDpi } from './render'
import { canvasToBlob, blobToBytes } from './text-raster'
import { optimizeDocument } from './ops'

export type CompressionLevel = 'light' | 'balanced' | 'strong' | 'extreme'

export interface CompressProfile {
  dpi: number
  quality: number
}

export const COMPRESSION_PROFILES: Record<CompressionLevel, CompressProfile> = {
  light: { dpi: 150, quality: 0.86 },
  balanced: { dpi: 120, quality: 0.72 },
  strong: { dpi: 96, quality: 0.58 },
  extreme: { dpi: 72, quality: 0.42 }
}

export interface CompressResult {
  bytes: Uint8Array
  before: number
  after: number
  /** True when re-rendering made things worse and the original was kept. */
  keptOriginal: boolean
}

export interface CompressOptions {
  level: CompressionLevel
  grayscale: boolean
  /** When false the document is only structurally optimized, never rasterized. */
  rasterize: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Two strategies: a lossless rebuild (object streams, dropped orphans), and a
 * lossy re-render of each page into a JPEG. Whichever ends up smaller wins,
 * and the original is kept if neither improves on it.
 */
export async function compressPdf(
  bytes: Uint8Array,
  options: CompressOptions,
  password?: string
): Promise<CompressResult> {
  const before = bytes.byteLength
  const lossless = await optimizeDocument(bytes, password).catch(() => bytes)

  if (!options.rasterize) {
    const better = lossless.byteLength < before
    return {
      bytes: better ? lossless : bytes,
      before,
      after: better ? lossless.byteLength : before,
      keptOriginal: !better
    }
  }

  const profile = COMPRESSION_PROFILES[options.level]
  const source = await openForRender(bytes, password)
  let rasterized: Uint8Array
  try {
    const target = await PDFDocument.create()
    const scale = scaleForDpi(profile.dpi)
    // One canvas for the whole run: a fresh one per page keeps every page's
    // backing store alive until the GC gets round to it, which on a long
    // document is hundreds of megabytes of dead pixels.
    const canvas = document.createElement('canvas')

    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      options.onProgress?.(pageNumber - 1, source.numPages)
      const page = await source.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const rendered = await renderPage(source, pageNumber, scale, canvas)

      if (options.grayscale) applyGrayscale(rendered.canvas)

      const blob = await canvasToBlob(rendered.canvas, 'image/jpeg', profile.quality)
      const image = await target.embedJpg(await blobToBytes(blob))
      const sheet = target.addPage([viewport.width, viewport.height])
      sheet.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height })
      page.cleanup()
      // Let the UI paint between pages; without this the busy veil's own
      // progress bar never moves.
      await new Promise((next) => setTimeout(next, 0))
    }
    options.onProgress?.(source.numPages, source.numPages)

    target.setProducer('Alcode Editor')
    target.setModificationDate(new Date())
    rasterized = await target.save({ useObjectStreams: true })
  } finally {
    // pdf.js keeps a worker and its page cache alive until the proxy is
    // destroyed, so this has to happen even when a page throws.
    await source.destroy().catch(() => undefined)
  }

  const candidates = [
    { bytes, size: before, original: true },
    { bytes: lossless, size: lossless.byteLength, original: false },
    { bytes: rasterized, size: rasterized.byteLength, original: false }
  ].sort((a, b) => a.size - b.size)

  const winner = candidates[0]
  return {
    bytes: winner.bytes,
    before,
    after: winner.size,
    keptOriginal: winner.original
  }
}

/**
 * Desaturates in place through the compositor rather than in JavaScript — a
 * per-pixel loop over an A4 page at 150 DPI is 6.2 million iterations on the
 * UI thread, and the browser does the same job on the GPU.
 */
function applyGrayscale(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) return
  context.save()
  context.filter = 'grayscale(1)'
  context.globalCompositeOperation = 'copy'
  context.drawImage(canvas, 0, 0)
  context.restore()
}
