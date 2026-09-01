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
  /** Honoured by the PDF rasteriser, which is the slow path. */
  signal?: AbortSignal
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
  /**
   * Set when a loose image was re-encoded into a different format, so the
   * caller can offer the right extension instead of saving JPEG bytes as .png.
   */
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png'
}

export const IMAGE_QUALITY: Record<CompressionLevel, number> = {
  light: 0.88,
  balanced: 0.75,
  strong: 0.6,
  extreme: 0.45
}

const ZIP_OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'docm', 'xlsm']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff']

/**
 * The single image type an archive entry may be rewritten as, given its name.
 *
 * Returns null for anything else in the package — including the formats no
 * canvas can re-encode faithfully — so those entries are copied through
 * untouched rather than converted into something their name does not describe.
 */
function allowedTypeFor(
  name: string
): readonly ('image/jpeg' | 'image/webp' | 'image/png')[] | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (extension === 'png') return ['image/png']
  if (extension === 'jpg' || extension === 'jpeg') return ['image/jpeg']
  if (extension === 'webp') return ['image/webp']
  return null
}

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
        onProgress: options.onProgress,
        signal: options.signal
      },
      password
    )
    return { ...result, target }
  }

  if (target === 'image') {
    // A loose image file is the one place the type may change freely: the
    // caller is saving it under a name of its own choosing.
    const compressed = await compressImage(bytes, options, ['image/jpeg', 'image/webp', 'image/png'])
    const better = compressed !== null && compressed.bytes.byteLength < before
    return {
      bytes: better ? compressed!.bytes : bytes,
      mimeType: better ? compressed!.mimeType : undefined,
      before,
      after: better ? compressed!.bytes.byteLength : before,
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
export interface CompressedImage {
  bytes: Uint8Array
  /** What the bytes actually are, so a caller never mislabels them. */
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png'
}

export async function compressImage(
  bytes: Uint8Array,
  options: UniversalCompressOptions,
  /**
   * Types the caller is able to store. Inside an office document that is the
   * one type the entry's own extension declares — see compressZipContainer.
   */
  allowedTypes: readonly ('image/jpeg' | 'image/webp' | 'image/png')[] = [
    'image/jpeg',
    'image/webp'
  ]
): Promise<CompressedImage | null> {
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
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // A transparent logo flattened onto white comes back with a white rectangle
  // behind it, which is worse than not compressing it at all. So transparency
  // is detected first, and an image that has any decides the question: it can
  // only be stored in a format with an alpha channel.
  const transparent = hasTransparency(context, width, height)
  const types = transparent
    ? allowedTypes.filter((type) => type !== 'image/jpeg')
    : options.convertPngToJpeg
      ? allowedTypes
      : allowedTypes.filter((type) => type !== 'image/jpeg')

  if (!transparent && types.includes('image/jpeg')) {
    // JPEG has no alpha, so an opaque image is put on white deliberately
    // rather than left to whatever the encoder does with unset pixels.
    const flattened = document.createElement('canvas')
    flattened.width = width
    flattened.height = height
    const target = flattened.getContext('2d')
    if (target) {
      target.fillStyle = '#ffffff'
      target.fillRect(0, 0, width, height)
      target.drawImage(canvas, 0, 0)
      context.clearRect(0, 0, width, height)
      context.drawImage(flattened, 0, 0)
    }
  }

  if (options.grayscale) applyGrayscale(context, width, height)

  const quality = IMAGE_QUALITY[options.level]
  const candidates: CompressedImage[] = []
  for (const type of types.length > 0 ? types : (['image/png'] as const)) {
    try {
      candidates.push({
        bytes: await blobToBytes(await canvasToBlob(canvas, type, quality)),
        mimeType: type
      })
    } catch {
      /* the browser may refuse a codec; the others still count */
    }
  }
  if (candidates.length === 0) return null

  return candidates.reduce((smallest, candidate) =>
    candidate.bytes.byteLength < smallest.bytes.byteLength ? candidate : smallest
  )
}

/** True as soon as one pixel is not fully opaque — no need to scan the rest. */
function hasTransparency(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const { data } = context.getImageData(0, 0, width, height)
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true
  }
  return false
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

    // An office part's format is declared by its extension in
    // [Content_Types].xml, and the entry name has to stay put or the
    // relationships stop resolving — so the bytes must match the name. The
    // previous version kept the name and wrote whichever of JPEG or WebP came
    // out smaller, which is how a .docx ends up with broken pictures or Word
    // offering to repair it. Only a type the extension already declares is
    // accepted; for a .png that means re-encoding as PNG, where the resize
    // alone is most of the saving anyway.
    const allowed = allowedTypeFor(entry.name)
    if (allowed && raw.byteLength > RECOMPRESS_THRESHOLD) {
      const shrunk = await compressImage(raw, options, allowed)
      if (shrunk && shrunk.bytes.byteLength < raw.byteLength) {
        output.file(entry.name, shrunk.bytes, {
          compression: 'DEFLATE',
          compressionOptions: { level: 9 }
        })
        rewritten += 1
        saved += raw.byteLength - shrunk.bytes.byteLength
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
