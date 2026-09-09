/**
 * Counting the things in a photograph.
 *
 * The job is a warehouse one — how many bags on the pallet, how many pipes in
 * the bundle, how many tablets on the tray — and it is the kind of arithmetic
 * a person gets wrong at forty and hopeless at four hundred. No model is
 * needed for it: the objects sit on a background of one colour, so separating
 * them is a threshold and a connected-component labelling, which is exact,
 * instant and runs on the device.
 *
 * What makes it usable rather than a demo is the filtering. A raw labelling
 * of a real photograph returns thousands of specks — sensor noise, a crumb, a
 * shadow edge. So blobs are measured, the median area of the plausible ones is
 * taken as "what an object looks like here", and anything far from it is
 * dropped; a blob several times the median is counted as the several touching
 * objects it almost certainly is.
 */

export interface CountedObject {
  /** Bounding box in image pixels. */
  x: number
  y: number
  width: number
  height: number
  area: number
  /** Centre, for drawing the marker. */
  cx: number
  cy: number
  /** How many objects this blob is taken to be — 2+ when they touch. */
  units: number
}

export interface CountOptions {
  /**
   * 0–1. Higher finds fainter objects and more noise with them; the default
   * suits a photograph of objects on a plain surface.
   */
  sensitivity?: number
  /** Ignore blobs smaller than this share of the image. Default 1/8000. */
  minArea?: number
  /** Treat a blob this many times the median as several touching objects. */
  splitFactor?: number
}

export interface CountResult {
  total: number
  objects: CountedObject[]
  /** The typical object, in pixels — what the filtering was calibrated on. */
  medianArea: number
  /** The grey level objects were separated from the background at. */
  threshold: number
}

/**
 * Counts the distinct objects in a canvas.
 *
 * The canvas is read once and never written, so the caller can draw its own
 * markers over the original afterwards.
 */
export function countObjects(canvas: HTMLCanvasElement, options: CountOptions = {}): CountResult {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { total: 0, objects: [], medianArea: 0, threshold: 0 }

  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  const grey = new Uint8Array(width * height)
  const histogram = new Uint32Array(256)
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000
    grey[p] = value
    histogram[value | 0] += 1
  }

  // Otsu picks the split between background and objects from the histogram
  // itself, so a dark tray and a white sheet both work without a setting.
  const sensitivity = clamp(options.sensitivity ?? 0.5, 0, 1)
  const threshold = clamp(otsu(histogram, width * height) + Math.round((sensitivity - 0.5) * 40), 1, 254)

  // Whichever side of the threshold is the minority is the objects: this is
  // what lets dark items on white paper and pale items on a dark tray both
  // count without the user choosing a polarity.
  let below = 0
  for (let i = 0; i <= threshold; i += 1) below += histogram[i]
  const objectsAreDark = below <= width * height - below

  const mask = new Uint8Array(width * height)
  for (let p = 0; p < mask.length; p += 1) {
    mask[p] = (objectsAreDark ? grey[p] <= threshold : grey[p] > threshold) ? 1 : 0
  }
  despeckle(mask, width, height)

  const blobs = label(mask, width, height)
  const floor = Math.max(6, Math.round(width * height * (options.minArea ?? 1 / 8000)))
  const plausible = blobs.filter((blob) => blob.area >= floor)
  if (plausible.length === 0) return { total: 0, objects: [], medianArea: 0, threshold }

  const median = medianOf(plausible.map((blob) => blob.area))
  // A speck a tenth the size of a real object is dirt; a blob eight times it
  // is the tray, the shadow or the whole background leaking through.
  const kept = plausible.filter((blob) => blob.area >= median * 0.28 && blob.area <= median * 8)
  const splitFactor = options.splitFactor ?? 1.6

  const objects = (kept.length > 0 ? kept : plausible).map((blob) => ({
    ...blob,
    units: blob.area > median * splitFactor ? Math.max(1, Math.round(blob.area / median)) : 1
  }))

  return {
    total: objects.reduce((sum, object) => sum + object.units, 0),
    objects,
    medianArea: median,
    threshold
  }
}

/* ------------------------------------------------------------- internals */

interface Blob {
  x: number
  y: number
  width: number
  height: number
  area: number
  cx: number
  cy: number
}

/**
 * Two passes of a 4-neighbour majority filter.
 *
 * One isolated pixel is noise and would otherwise be a counted object; a
 * one-pixel gap is a JPEG artefact and would otherwise split one object in
 * two. Both are fixed by asking whether a pixel agrees with its neighbours.
 */
function despeckle(mask: Uint8Array, width: number, height: number): void {
  const copy = new Uint8Array(mask)
  for (let pass = 0; pass < 2; pass += 1) {
    copy.set(mask)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = y * width + x
        const around =
          copy[p - 1] + copy[p + 1] + copy[p - width] + copy[p + width]
        if (copy[p] === 1 && around === 0) mask[p] = 0
        else if (copy[p] === 0 && around === 4) mask[p] = 1
      }
    }
  }
}

/**
 * Connected components, 8-neighbour, with an explicit stack.
 *
 * Recursion overflows on a full-resolution photograph — a single background
 * blob can be a million pixels — so the frontier is a typed array used as a
 * stack, which also keeps the whole pass allocation-free.
 */
function label(mask: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  const blobs: Blob[] = []

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || seen[start] === 1) continue
    // `top` is the count of entries, so a push writes at `top` and a pop reads
    // at `top - 1`. Writing the two as `stack[top += 1]` / `stack[top -= 1]`
    // reads symmetrically and is off by one in both directions.
    let top = 0
    stack[top] = start
    top += 1
    seen[start] = 1

    let area = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    let sumX = 0
    let sumY = 0

    while (top > 0) {
      top -= 1
      const p = stack[top]
      const x = p % width
      const y = (p - x) / width
      area += 1
      sumX += x
      sumY += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const q = ny * width + nx
          if (mask[q] === 1 && seen[q] === 0) {
            seen[q] = 1
            stack[top] = q
            top += 1
          }
        }
      }
    }

    blobs.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
      cx: sumX / area,
      cy: sumY / area
    })
  }
  return blobs
}

/** The grey level that best separates the histogram into two masses. */
function otsu(histogram: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]

  let sumBack = 0
  let weightBack = 0
  let best = 0
  let bestVariance = -1
  for (let value = 0; value < 256; value += 1) {
    weightBack += histogram[value]
    if (weightBack === 0) continue
    const weightFore = total - weightBack
    if (weightFore === 0) break
    sumBack += value * histogram[value]
    const meanBack = sumBack / weightBack
    const meanFore = (sum - sumBack) / weightFore
    const variance = weightBack * weightFore * (meanBack - meanFore) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = value
    }
  }
  return best
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}
