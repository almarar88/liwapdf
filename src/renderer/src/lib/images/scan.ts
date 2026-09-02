/**
 * Makes a photographed page look like a scan.
 *
 * A phone photo of a document arrives grey, unevenly lit and slightly
 * yellow, and OCR and readers both suffer for it. The fix a scanner does
 * in hardware is done here in software: estimate the paper's brightness
 * and the ink's darkness from the histogram, stretch the range between
 * them so the paper becomes white and the ink black, and lift the last of
 * the grey off the paper. Colour is dropped unless asked for — a document
 * is ink on paper, and the colour cast is the room, not the page.
 */

export interface ScanOptions {
  /** Keep colour rather than converting to grey. */
  keepColor?: boolean
  /** Snap near-white paper to pure white. */
  whiten?: boolean
  /** Straighten tilted text lines first. */
  deskew?: boolean
}

export function enhanceScan(canvas: HTMLCanvasElement, options: ScanOptions = {}): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  const histogram = new Uint32Array(256)
  const count = canvas.width * canvas.height
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])] += 1
  }
  // Paper is the bright mass of the picture; ink the dark tail.
  const paper = percentile(histogram, count, 0.9)
  const ink = percentile(histogram, count, 0.02)
  const low = Math.max(0, Math.min(ink, paper - 40))
  const high = Math.max(low + 40, paper)
  const range = high - low
  const whiten = options.whiten ?? true
  const whiteFrom = high - range * 0.12

  for (let i = 0; i < data.length; i += 4) {
    if (options.keepColor) {
      for (let c = 0; c < 3; c += 1) {
        const value = ((data[i + c] - low) / range) * 255
        data[i + c] = value < 0 ? 0 : value > 255 ? 255 : value
      }
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (whiten && y >= ((whiteFrom - low) / range) * 255) data[i] = data[i + 1] = data[i + 2] = 255
    } else {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      let value = ((y - low) / range) * 255
      if (whiten && y >= whiteFrom) value = 255
      value = value < 0 ? 0 : value > 255 ? 255 : value
      data[i] = data[i + 1] = data[i + 2] = value
    }
  }
  context.putImageData(image, 0, 0)
}

function percentile(histogram: Uint32Array, count: number, fraction: number): number {
  let seen = 0
  const target = count * fraction
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]
    if (seen >= target) return value
  }
  return 255
}

/** Decodes an image file, enhances it, and returns it as JPEG. */
export async function enhanceImageBytes(bytes: Uint8Array, options: ScanOptions = {}): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { alpha: false })!
    context.drawImage(bitmap, 0, 0)
    if (options.deskew ?? true) {
      const { deskew } = await import('./deskew')
      deskew(canvas)
    }
    enhanceScan(canvas, options)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('encode-failed')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
