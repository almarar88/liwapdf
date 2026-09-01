import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream
} from '@cantoo/pdf-lib'
import { openForRender } from './pdfjs'
import { renderPage, scaleForDpi } from './render'
import { canvasToBlob, blobToBytes } from './text-raster'
import { load, optimizeDocument, save } from './ops'

export type CompressionLevel = 'light' | 'balanced' | 'strong' | 'extreme'

export interface CompressProfile {
  dpi: number
  quality: number
  /** Longest edge an embedded picture is allowed to keep, in pixels. */
  maxImageEdge: number
}

export const COMPRESSION_PROFILES: Record<CompressionLevel, CompressProfile> = {
  light: { dpi: 150, quality: 0.86, maxImageEdge: 2200 },
  balanced: { dpi: 120, quality: 0.72, maxImageEdge: 1600 },
  strong: { dpi: 96, quality: 0.58, maxImageEdge: 1200 },
  extreme: { dpi: 72, quality: 0.42, maxImageEdge: 900 }
}

export interface CompressResult {
  bytes: Uint8Array
  before: number
  after: number
  /** True when nothing improved on the original and it was kept. */
  keptOriginal: boolean
  /** Embedded pictures rewritten at lower resolution, when that path won. */
  imagesRecompressed: number
}

export interface CompressOptions {
  level: CompressionLevel
  grayscale: boolean
  /**
   * Re-render every page as one JPEG. The strongest option and the crudest:
   * text becomes a picture, so it can no longer be selected, searched or
   * read by a screen reader. Off, the document keeps its text and only the
   * pictures inside it are rewritten.
   */
  rasterize: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Three strategies, and whichever ends up smallest wins:
 *
 * - a lossless rebuild (object streams, dropped orphans);
 * - the same document with its embedded pictures decoded, scaled down to
 *   the level's cap and re-encoded as JPEG — text, vectors and fonts are
 *   untouched, so the page stays sharp and selectable;
 * - optionally, every page re-rendered into one JPEG.
 *
 * The original is kept if none of them improves on it.
 */
export async function compressPdf(
  bytes: Uint8Array,
  options: CompressOptions,
  password?: string
): Promise<CompressResult> {
  const before = bytes.byteLength
  const lossless = await optimizeDocument(bytes, password).catch(() => bytes)

  const pictures = await recompressImages(bytes, options, password).catch(() => null)
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')

  const candidates: { bytes: Uint8Array; size: number; original: boolean; images: number }[] = [
    { bytes, size: before, original: true, images: 0 },
    { bytes: lossless, size: lossless.byteLength, original: false, images: 0 }
  ]
  if (pictures && pictures.replaced > 0) {
    candidates.push({ bytes: pictures.bytes, size: pictures.bytes.byteLength, original: false, images: pictures.replaced })
  }

  if (options.rasterize) {
    const rasterized = await rasterizeDocument(bytes, options, password)
    candidates.push({ bytes: rasterized, size: rasterized.byteLength, original: false, images: 0 })
  }

  candidates.sort((a, b) => a.size - b.size)
  const winner = candidates[0]
  return {
    bytes: winner.bytes,
    before,
    after: winner.size,
    keptOriginal: winner.original,
    imagesRecompressed: winner.images
  }
}

/* ------------------------------------------------------- picture rewrite */

interface ImageSource {
  width: number
  height: number
  /** Samples per pixel of the decoded stream: 1 for gray, 3 for RGB. */
  channels: 1 | 3
  filter: 'none' | 'flate' | 'jpeg'
}

/**
 * Rewrites each embedded picture the document carries at a lower resolution
 * and quality, in place, leaving everything else in the file exactly as it
 * was. This is what "compress" means in every serious PDF tool: a scanned
 * contract loses the 600 DPI nobody can see, and the text next to it stays
 * text.
 *
 * Only pictures that can be decoded faithfully here are touched — 8-bit
 * gray or RGB, stored raw, deflated or as JPEG. Anything with a soft mask, a
 * stencil, a palette, CMYK, JPEG 2000 or a fax encoding is left alone rather
 * than risked: a wrong guess corrupts a page, and the untouched picture is
 * merely large.
 */
export async function recompressImages(
  bytes: Uint8Array,
  options: CompressOptions,
  password?: string
): Promise<{ bytes: Uint8Array; images: number; replaced: number }> {
  const profile = COMPRESSION_PROFILES[options.level]
  const document = await load(bytes, password)
  const context = document.context

  const targets: { ref: Parameters<typeof context.assign>[0]; stream: PDFRawStream; source: ImageSource }[] = []
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
    const source = describeImage(object, document)
    if (source) targets.push({ ref, stream: object, source })
  }

  const canvas = window.document.createElement('canvas')
  let replaced = 0
  for (const [index, target] of targets.entries()) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    options.onProgress?.(index, targets.length)

    const encoded = await reencode(target.stream, target.source, profile, options.grayscale, canvas).catch(
      () => null
    )
    if (!encoded || encoded.bytes.byteLength >= target.stream.contents.byteLength) continue

    const stream = context.stream(encoded.bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: encoded.width,
      Height: encoded.height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode'
    })
    context.assign(target.ref, stream)
    replaced += 1
    // Let the veil's progress bar paint between pictures.
    await new Promise((next) => setTimeout(next, 0))
  }
  options.onProgress?.(targets.length, targets.length)

  return { bytes: replaced > 0 ? await save(document) : bytes, images: targets.length, replaced }
}

function describeImage(stream: PDFRawStream, document: PDFDocument): ImageSource | null {
  const dict = stream.dict
  const name = (key: string): PDFName => PDFName.of(key)

  // Anything beyond a plain picture is left as it is.
  for (const key of ['SMask', 'Mask', 'Decode', 'ImageMask', 'DecodeParms']) {
    if (dict.has(name(key))) return null
  }
  const bits = dict.get(name('BitsPerComponent'))
  if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) return null

  const width = dict.get(name('Width'))
  const height = dict.get(name('Height'))
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return null
  // Icons and rules are not where the bytes are.
  if (width.asNumber() < 96 || height.asNumber() < 96) return null

  const filters = filterNames(dict.get(name('Filter')), document)
  let filter: ImageSource['filter']
  if (filters.length === 0) filter = 'none'
  else if (filters.length === 1 && filters[0] === 'FlateDecode') filter = 'flate'
  else if (filters.length === 1 && filters[0] === 'DCTDecode') filter = 'jpeg'
  else return null

  const channels = channelsOf(dict.get(name('ColorSpace')), document)
  if (!channels) return null

  return { width: width.asNumber(), height: height.asNumber(), channels, filter }
}

function filterNames(value: unknown, document: PDFDocument): string[] {
  const resolved = value instanceof PDFName || value instanceof PDFArray ? value : document.context.lookup(value as never)
  if (resolved instanceof PDFName) return [resolved.decodeText()]
  if (resolved instanceof PDFArray) {
    return resolved.asArray().map((entry) => {
      const item = document.context.lookup(entry)
      return item instanceof PDFName ? item.decodeText() : '?'
    })
  }
  return []
}

/** 1 for a gray space, 3 for RGB, null for anything else (CMYK, palettes, Lab…). */
function channelsOf(value: unknown, document: PDFDocument): 1 | 3 | null {
  const resolved = document.context.lookup(value as never) ?? value
  if (resolved instanceof PDFName) {
    const text = resolved.decodeText()
    if (text === 'DeviceRGB' || text === 'CalRGB') return 3
    if (text === 'DeviceGray' || text === 'CalGray') return 1
    return null
  }
  if (resolved instanceof PDFArray && resolved.size() >= 2) {
    const family = document.context.lookup(resolved.get(0))
    if (!(family instanceof PDFName)) return null
    const familyName = family.decodeText()
    if (familyName === 'ICCBased') {
      const profile = document.context.lookup(resolved.get(1))
      const n = profile instanceof PDFRawStream ? profile.dict.get(PDFName.of('N')) : null
      if (n instanceof PDFNumber) return n.asNumber() === 3 ? 3 : n.asNumber() === 1 ? 1 : null
      return null
    }
    if (familyName === 'CalRGB') return 3
    if (familyName === 'CalGray') return 1
  }
  return null
}

/**
 * Decodes one picture into a canvas, scales it to the profile's cap and
 * returns it as JPEG. The canvas is shared across calls so a document with
 * five hundred photographs does not hold five hundred backing stores.
 */
async function reencode(
  stream: PDFRawStream,
  source: ImageSource,
  profile: CompressProfile,
  grayscale: boolean,
  canvas: HTMLCanvasElement
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const scale = Math.min(1, profile.maxImageEdge / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null
  context.filter = grayscale ? 'grayscale(1)' : 'none'

  if (source.filter === 'jpeg') {
    const bitmap = await createImageBitmap(new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }))
    try {
      // A size that disagrees with the dictionary means a JPEG this decoder
      // read differently from the PDF viewer; leave it alone.
      if (bitmap.width !== source.width || bitmap.height !== source.height) return null
      context.drawImage(bitmap, 0, 0, width, height)
    } finally {
      bitmap.close()
    }
  } else {
    const samples = source.filter === 'flate' ? decodePDFRawStream(stream).decode() : stream.contents
    const expected = source.width * source.height * source.channels
    if (samples.byteLength < expected) return null
    const pixels = new ImageData(source.width, source.height)
    const out = pixels.data
    if (source.channels === 3) {
      for (let i = 0, j = 0; i < expected; i += 3, j += 4) {
        out[j] = samples[i]
        out[j + 1] = samples[i + 1]
        out[j + 2] = samples[i + 2]
        out[j + 3] = 255
      }
    } else {
      for (let i = 0, j = 0; i < expected; i += 1, j += 4) {
        out[j] = out[j + 1] = out[j + 2] = samples[i]
        out[j + 3] = 255
      }
    }
    const full = await createImageBitmap(pixels)
    try {
      context.drawImage(full, 0, 0, width, height)
    } finally {
      full.close()
    }
  }

  const blob = await canvasToBlob(canvas, 'image/jpeg', profile.quality)
  return { bytes: await blobToBytes(blob), width, height }
}

/* ------------------------------------------------------------ rasterize */

async function rasterizeDocument(
  bytes: Uint8Array,
  options: CompressOptions,
  password?: string
): Promise<Uint8Array> {
  const profile = COMPRESSION_PROFILES[options.level]
  const source = await openForRender(bytes, password)
  try {
    const target = await PDFDocument.create()
    const scale = scaleForDpi(profile.dpi)
    // One canvas for the whole run: a fresh one per page keeps every page's
    // backing store alive until the GC gets round to it, which on a long
    // document is hundreds of megabytes of dead pixels.
    const canvas = window.document.createElement('canvas')

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
    return await target.save({ useObjectStreams: true })
  } finally {
    // pdf.js keeps a worker and its page cache alive until the proxy is
    // destroyed, so this has to happen even when a page throws.
    await source.destroy().catch(() => undefined)
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
