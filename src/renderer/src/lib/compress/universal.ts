import JSZip from 'jszip'
import { compressPdf, type CompressionLevel } from '../pdf/compress'
import { canvasToBlob, blobToBytes } from '../pdf/text-raster'
import { extensionOf } from '../format'
import { isZipContainer } from '../documents/formats'

/**
 * One "make this file smaller" entry point for every format the app touches.
 *
 * PDFs go through the dedicated PDF pipeline; images are re-encoded through a
 * canvas; the ZIP-packaged office formats are unpacked, their embedded photos
 * shrunk, and repacked at maximum deflate. Whatever the route, the result is
 * only kept when it actually came out smaller.
 */

export type CompressTarget = 'pdf' | 'image' | 'zip-office' | 'zip' | 'none'

export interface UniversalCompressOptions {
  level: CompressionLevel
  /** Longest edge an embedded or standalone image may keep, in pixels. */
  maxImageDimension: number
  grayscale: boolean
  /** Re-render PDF pages as images. Off keeps text selectable and sharp. */
  rasterizePdf: boolean
  /** Re-encode PNG photos as JPEG when that is smaller. */
  convertPngToJpeg: boolean
  onProgress?: (done: number, total: number) => void
}

export interface UniversalCompressResult {
  bytes: Uint8Array
  before: number
  after: number
  target: CompressTarget
  /** True when nothing beat the original and it was kept as-is. */
  keptOriginal: boolean
  /** Human-readable note, e.g. how many embedded images were re-encoded. */
  detail?: string
}

export const IMAGE_QUALITY: Record<CompressionLevel, number> = {
  light: 0.88,
  balanced: 0.75,
  strong: 0.6,
  extreme: 0.45
}

const ZIP_OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'docm', 'xlsm']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff']

export function compressionTargetFor(name: string, bytes: Uint8Array): CompressTarget {
  const extension = extensionOf(name)
  if (extension === 'pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50)) return 'pdf'
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image'
  if (ZIP_OFFICE_EXTENSIONS.includes(extension)) return 'zip-office'
  if (isZipContainer(bytes)) return 'zip'
  return 'none'
}

export async function compressFile(
  name: string,
  bytes: Uint8Array,
  options: UniversalCompressOptions,
  password?: string
): Promise<UniversalCompressResult> {
  const before = bytes.byteLength
  const target = compressionTargetFor(name, bytes)

  if (target === 'pdf') {
    const result = await compressPdf(
      bytes,
      {
        level: options.level,
        grayscale: options.grayscale,
        rasterize: options.rasterizePdf,
        onProgress: options.onProgress
      },
      password
    )
    return { ...result, target }
  }

  if (target === 'image') {
    const compressed = await compressImage(bytes, options)
    const better = compressed !== null && compressed.byteLength < before
    return {
      bytes: better ? compressed! : bytes,
      before,
      after: better ? compressed!.byteLength : before,
      target,
      keptOriginal: !better
    }
  }

  if (target === 'zip-office' || target === 'zip') {
    const result = await compressZipContainer(bytes, options)
    const better = result.bytes.byteLength < before
    return {
      bytes: better ? result.bytes : bytes,
      before,
      after: better ? result.bytes.byteLength : before,
      target,
      keptOriginal: !better,
      detail: result.detail
    }
  }

  return { bytes, before, after: before, target: 'none', keptOriginal: true }
}

/**
 * Re-encodes an image through a canvas, capping its longest edge. Both JPEG and
 * WebP are tried because which one wins depends entirely on the picture.
 */
export async function compressImage(
  bytes: Uint8Array,
  options: UniversalCompressOptions
): Promise<Uint8Array | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]))
  } catch {
    return null
  }

  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > options.maxImageDimension ? options.maxImageDimension / longest : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return null
  }
  // Flatten onto white: JPEG has no alpha channel to preserve.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  if (options.grayscale) applyGrayscale(context, width, height)

  const quality = IMAGE_QUALITY[options.level]
  const candidates: Uint8Array[] = []
  for (const type of ['image/jpeg', 'image/webp'] as const) {
    try {
      candidates.push(await blobToBytes(await canvasToBlob(canvas, type, quality)))
    } catch {
      /* the browser may refuse a codec; the other one still counts */
    }
  }
  if (candidates.length === 0) return null

  return candidates.reduce((smallest, candidate) =>
    candidate.byteLength < smallest.byteLength ? candidate : smallest
  )
}

function applyGrayscale(context: CanvasRenderingContext2D, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
    data[index] = luma
    data[index + 1] = luma
    data[index + 2] = luma
  }
  context.putImageData(image, 0, 0)
}

const RECOMPRESS_THRESHOLD = 24 * 1024

async function compressZipContainer(
  bytes: Uint8Array,
  options: UniversalCompressOptions
): Promise<{ bytes: Uint8Array; detail?: string }> {
  const zip = await JSZip.loadAsync(bytes)
  const output = new JSZip()

  const entries: JSZip.JSZipObject[] = []
  zip.forEach((_path, file) => {
    if (!file.dir) entries.push(file)
  })

  let rewritten = 0
  let saved = 0

  for (const [index, entry] of entries.entries()) {
    options.onProgress?.(index, entries.length)
    const raw = await entry.async('uint8array')

    // The ODF mimetype entry is required to stay first and uncompressed.
    if (entry.name === 'mimetype') {
      output.file(entry.name, raw, { compression: 'STORE' })
      continue
    }

    const isImage = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(entry.name)
    if (isImage && raw.byteLength > RECOMPRESS_THRESHOLD) {
      const shrunk = await compressImage(raw, options)
      if (shrunk && shrunk.byteLength < raw.byteLength) {
        // Keep the original entry name so the document's relationships still resolve.
        output.file(entry.name, shrunk, { compression: 'DEFLATE', compressionOptions: { level: 9 } })
        rewritten += 1
        saved += raw.byteLength - shrunk.byteLength
        continue
      }
    }

    output.file(entry.name, raw, { compression: 'DEFLATE', compressionOptions: { level: 9 } })
  }
  options.onProgress?.(entries.length, entries.length)

  const packed = await output.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })

  return {
    bytes: packed,
    detail: rewritten > 0 ? `${rewritten} images re-encoded (${Math.round(saved / 1024)} KB)` : undefined
  }
}
