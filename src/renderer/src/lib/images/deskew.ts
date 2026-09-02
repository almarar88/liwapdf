/**
 * Straightens a page that was photographed or fed through a scanner at a
 * slight angle.
 *
 * Text lines are dense horizontal bands of ink. Project the dark pixels
 * onto the vertical axis and the bands give a spiky profile; tilt the page
 * and the spikes smear into a flat one. So the angle is whichever rotation
 * makes the profile spikiest — measured by its variance — searched coarsely
 * across ±6° and then refined. Beyond six degrees the page needs a hand,
 * not a heuristic.
 */

export function estimateSkew(canvas: HTMLCanvasElement): number {
  const scale = Math.min(1, 600 / Math.max(canvas.width, canvas.height))
  const width = Math.max(1, Math.round(canvas.width * scale))
  const height = Math.max(1, Math.round(canvas.height * scale))
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const context = small.getContext('2d', { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0, width, height)
  const data = context.getImageData(0, 0, width, height).data

  // Dark pixels only, relative to the page's own paper tone.
  const dark: { x: number; y: number }[] = []
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += data[i]
  const threshold = Math.min(160, (sum / (data.length / 4)) * 0.7)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < threshold) dark.push({ x: x - width / 2, y: y - height / 2 })
    }
  }
  if (dark.length < 50) return 0

  const score = (degrees: number): number => {
    const radians = (degrees * Math.PI) / 180
    const sin = Math.sin(radians)
    const cos = Math.cos(radians)
    const bins = new Float64Array(height + 2)
    for (const point of dark) {
      const row = Math.round(point.y * cos - point.x * sin + height / 2)
      if (row >= 0 && row < bins.length) bins[row] += 1
    }
    let mean = 0
    for (const value of bins) mean += value
    mean /= bins.length
    let variance = 0
    for (const value of bins) variance += (value - mean) ** 2
    return variance
  }

  let best = 0
  let bestScore = -1
  for (let angle = -6; angle <= 6; angle += 0.5) {
    const value = score(angle)
    if (value > bestScore) {
      bestScore = value
      best = angle
    }
  }
  for (let angle = best - 0.4; angle <= best + 0.4; angle += 0.1) {
    const value = score(angle)
    if (value > bestScore) {
      bestScore = value
      best = angle
    }
  }
  return Math.round(best * 10) / 10
}

/** Rotates the canvas in place so its text lines run level. Returns the angle removed. */
export function deskew(canvas: HTMLCanvasElement): number {
  const angle = estimateSkew(canvas)
  if (Math.abs(angle) < 0.2) return 0
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  copy.getContext('2d')!.drawImage(canvas, 0, 0)
  const context = canvas.getContext('2d')!
  context.save()
  // Whatever transform the caller left on the context must not compound
  // with the correction: rotate about the page's real centre.
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((-angle * Math.PI) / 180)
  context.drawImage(copy, -canvas.width / 2, -canvas.height / 2)
  context.restore()
  return angle
}
