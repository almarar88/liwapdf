import jsQR from 'jsqr'

/**
 * Reading the code in a photograph.
 *
 * A QR code on a bill, a parcel or a restaurant table is a thing a phone is
 * pointed at several times a day, and this app already carried a decoder for
 * its own tests — so the capability was in the bundle and simply not offered.
 *
 * The work here is not the decode, which is one call; it is getting a real
 * photograph to decode at all. A code shot at arm's length is a few hundred
 * pixels inside a twelve-megapixel frame, often slightly dark and often
 * inverted (white on black is common on packaging). So the frame is retried:
 * at a couple of scales, in the middle where people aim, and with the
 * brightness stretched — cheap passes that between them find codes a single
 * attempt misses.
 */

export interface CodeResult {
  text: string
  /** What the payload appears to be, so the caller can offer the right action. */
  kind: 'url' | 'phone' | 'email' | 'wifi' | 'contact' | 'text'
  /** Corner points in the image, for drawing the outline. */
  corners: { x: number; y: number }[]
}

/** Decodes the first code found, or null when the picture holds none. */
export function readCode(canvas: HTMLCanvasElement): CodeResult | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  for (const attempt of attempts(canvas)) {
    const image = attempt.context.getImageData(0, 0, attempt.width, attempt.height)
    // "attemptBoth" also tries the inverted image, which is what packaging
    // and dark-mode screens print.
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
    if (!found?.data) continue
    const map = attempt.toSource
    return {
      text: found.data,
      kind: classify(found.data),
      corners: [
        found.location.topLeftCorner,
        found.location.topRightCorner,
        found.location.bottomRightCorner,
        found.location.bottomLeftCorner
      ].map(map)
    }
  }
  return null
}

interface Attempt {
  context: CanvasRenderingContext2D
  width: number
  height: number
  /** Maps a point in the attempt's frame back to the original picture. */
  toSource: (point: { x: number; y: number }) => { x: number; y: number }
}

/**
 * The passes, cheapest and most likely first.
 *
 * Full frame at a working size catches most codes; the centre crop catches
 * the small distant one by giving the decoder more pixels per module; the
 * contrast pass catches the code photographed in poor light.
 */
function* attempts(source: HTMLCanvasElement): Generator<Attempt> {
  const scale = Math.min(1, 1000 / Math.max(source.width, source.height))
  yield frame(source, 0, 0, source.width, source.height, scale)

  const inset = 0.28
  const x = Math.round(source.width * (inset / 2))
  const y = Math.round(source.height * (inset / 2))
  const width = Math.round(source.width * (1 - inset))
  const height = Math.round(source.height * (1 - inset))
  yield frame(source, x, y, width, height, Math.min(1, 1000 / Math.max(width, height)))

  const stretched = frame(source, 0, 0, source.width, source.height, scale)
  contrast(stretched.context, stretched.width, stretched.height)
  yield stretched
}

function frame(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number
): Attempt {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height)
  return {
    context,
    width: canvas.width,
    height: canvas.height,
    toSource: (point) => ({ x: x + point.x / scale, y: y + point.y / scale })
  }
}

/** Pushes the darkest tenth to black and the brightest tenth to white. */
function contrast(context: CanvasRenderingContext2D, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    histogram[(data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000] += 1
  }
  const total = width * height
  const low = percentile(histogram, total, 0.1)
  const high = Math.max(low + 24, percentile(histogram, total, 0.9))
  const range = high - low
  for (let i = 0; i < data.length; i += 4) {
    const grey = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    const value = ((grey - low) / range) * 255
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value
    data[i] = clamped
    data[i + 1] = clamped
    data[i + 2] = clamped
  }
  context.putImageData(image, 0, 0)
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  let seen = 0
  const target = total * fraction
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]
    if (seen >= target) return value
  }
  return 255
}

/** What the payload is, from the shapes codes actually carry. */
export function classify(text: string): CodeResult['kind'] {
  if (/^https?:\/\//i.test(text)) return 'url'
  if (/^(tel|sms):/i.test(text)) return 'phone'
  if (/^mailto:/i.test(text) || /^[\w.+-]+@[\w-]+\.[\w.]{2,}$/.test(text)) return 'email'
  if (/^WIFI:/i.test(text)) return 'wifi'
  if (/^(BEGIN:VCARD|MECARD:)/i.test(text)) return 'contact'
  return 'text'
}

/**
 * The network name inside a Wi-Fi code, which is the part worth showing.
 *
 * The payload is `WIFI:` and then `key:value;` fields in any order, with `;`
 * `:` `\\` and `,` backslash-escaped inside a value. So the fields are split on
 * unescaped semicolons rather than matched with one expression — a lookbehind
 * for "not after a backslash" gets `S:` wrong whenever the field happens to
 * be first, which is exactly how most routers print it.
 */
export function wifiName(text: string): string | null {
  const body = /^WIFI:/i.exec(text) ? text.slice(5) : null
  if (body === null) return null

  let field = ''
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && i + 1 < body.length) {
      field += body[i] + body[i + 1]
      i += 1
      continue
    }
    if (body[i] === ';') {
      const name = unescapeField(field)
      if (name !== null) return name
      field = ''
      continue
    }
    field += body[i]
  }
  return unescapeField(field)
}

function unescapeField(field: string): string | null {
  if (!/^S:/i.test(field)) return null
  return field.slice(2).replace(/\\(.)/g, '$1')
}
