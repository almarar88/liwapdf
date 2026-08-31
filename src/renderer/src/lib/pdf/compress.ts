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
  const target = await PDFDocument.create()
  const scale = scaleForDpi(profile.dpi)

  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    options.onProgress?.(pageNumber - 1, source.numPages)
    const page = await source.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const rendered = await renderPage(source, pageNumber, scale)

    if (options.grayscale) applyGrayscale(rendered.canvas)

    const blob = await canvasToBlob(rendered.canvas, 'image/jpeg', profile.quality)
    const image = await target.embedJpg(await blobToBytes(blob))
    const sheet = target.addPage([viewport.width, viewport.height])
    sheet.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height })
    page.cleanup()
  }
  options.onProgress?.(source.numPages, source.numPages)

  target.setProducer('Alcode Editor')
  target.setModificationDate(new Date())
  const rasterized = await target.save({ useObjectStreams: true })
  await source.destroy()

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

function applyGrayscale(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
    data[index] = luma
    data[index + 1] = luma
    data[index + 2] = luma
  }
  context.putImageData(image, 0, 0)
}
