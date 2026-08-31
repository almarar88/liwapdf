import { needsComplexShaping } from '../format'

export interface RasterTextOptions {
  fontSize: number
  fontFamily?: string
  color: string
  bold?: boolean
  italic?: boolean
  /** Oversampling factor: 4 keeps small text crisp when scaled into the page. */
  scale?: number
}

export interface RasterText {
  png: Uint8Array
  /** Layout size in PDF points (already divided by the oversampling factor). */
  width: number
  height: number
}

const ARABIC_STACK =
  '"SF Arabic", "Geeza Pro", "Dubai", "Segoe UI", "Noto Naskh Arabic", "Traditional Arabic", sans-serif'
const LATIN_STACK = '"SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif'

/**
 * Renders a string to a transparent PNG using the browser text engine.
 *
 * pdf-lib's base-14 fonts only cover WinAnsi, so anything outside it (Arabic
 * above all) is drawn here instead. Going through canvas also means Arabic gets
 * proper contextual shaping and RTL ordering with no shaping library shipped.
 */
export function rasterizeText(text: string, options: RasterTextOptions): RasterText {
  const scale = options.scale ?? 4
  const stack = options.fontFamily ?? (needsComplexShaping(text) ? ARABIC_STACK : LATIN_STACK)
  const font = `${options.italic ? 'italic ' : ''}${options.bold ? '700 ' : '400 '}${
    options.fontSize * scale
  }px ${stack}`

  const measurer = document.createElement('canvas').getContext('2d')
  if (!measurer) throw new Error('canvas-unavailable')
  measurer.font = font
  const lines = text.split('\n')
  const metrics = lines.map((line) => measurer.measureText(line))
  const width = Math.max(1, Math.ceil(Math.max(...metrics.map((m) => m.width))))
  const lineHeight = Math.ceil(options.fontSize * scale * 1.32)
  const height = Math.max(1, lineHeight * lines.length)

  const canvas = document.createElement('canvas')
  canvas.width = width + 8
  canvas.height = height + 8
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas-unavailable')
  context.font = font
  context.fillStyle = options.color
  context.textBaseline = 'top'
  context.direction = needsComplexShaping(text) ? 'rtl' : 'ltr'
  lines.forEach((line, index) => {
    const x = context.direction === 'rtl' ? canvas.width - 4 : 4
    context.fillText(line, x, 4 + index * lineHeight)
  })

  return {
    png: dataUrlToBytes(canvas.toDataURL('image/png')),
    width: canvas.width / scale,
    height: canvas.height / scale
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas-encode-failed'))),
      type,
      quality
    )
  })
}
