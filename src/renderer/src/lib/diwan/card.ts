import type { Poem, Verse } from './types'

/**
 * A verse card for sharing.
 *
 * The one thing a poet does with a new verse before anything else is send
 * it: to a friend, a group, a story. A screenshot of the editor is neither
 * legible nor flattering, so the app draws the picture itself — a portrait
 * card in the bundled calligraphic face, the chosen verses centred, the
 * poet's name under a small ornament — sized for a phone screen and a feed.
 */

export interface CardOptions {
  poet: string
  /** Warm paper, deep night, or plain ivory. */
  theme: 'paper' | 'night' | 'ivory'
  /** Rendered from the verses the poet picked, or the first few. */
  verses: Verse[]
  title?: string
}

const THEMES = {
  paper: { back: ['#f6efe1', '#ead9bb'], ink: '#2a2118', soft: '#7d6a4f', gold: '#a8823f' },
  night: { back: ['#141a26', '#0b0f17'], ink: '#f2ebdc', soft: '#b3a68c', gold: '#d2b06a' },
  ivory: { back: ['#fbfaf7', '#f1eee6'], ink: '#1f1f1f', soft: '#6b6b6b', gold: '#9a8a5a' }
} as const

const WIDTH = 1080
const HEIGHT = 1350

export async function renderVerseCard(poem: Poem, options: CardOptions): Promise<Blob> {
  const family = '"Alcode Amiri", "Amiri", "Noto Naskh Arabic", "Traditional Arabic", serif'
  // The bundled face is declared in CSS; the canvas needs it resolved before
  // it draws, or the first card ever made comes out in the fallback font.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await Promise.all([
      document.fonts.load(`700 60px ${family}`),
      document.fonts.load(`400 44px ${family}`)
    ]).catch(() => undefined)
  }

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas-unavailable')
  const theme = THEMES[options.theme]

  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, theme.back[0])
  gradient.addColorStop(1, theme.back[1])
  context.fillStyle = gradient
  context.fillRect(0, 0, WIDTH, HEIGHT)

  // Frame.
  context.strokeStyle = theme.gold
  context.lineWidth = 3
  context.strokeRect(48, 48, WIDTH - 96, HEIGHT - 96)
  context.lineWidth = 1
  context.strokeRect(60, 60, WIDTH - 120, HEIGHT - 120)

  context.direction = 'rtl'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const verses = options.verses.filter((verse) => verse.sadr.trim() || verse.ajuz.trim()).slice(0, 6)
  const lines: { text: string; kind: 'sadr' | 'ajuz' }[] = []
  for (const verse of verses) {
    if (verse.sadr.trim()) lines.push({ text: verse.sadr.trim(), kind: 'sadr' })
    if (verse.ajuz.trim()) lines.push({ text: verse.ajuz.trim(), kind: 'ajuz' })
  }

  // The type fits the longest line; the leading fits the count.
  let size = 58
  context.font = `400 ${size}px ${family}`
  const maxWidth = WIDTH - 220
  const widest = Math.max(1, ...lines.map((line) => context.measureText(line.text).width))
  if (widest > maxWidth) size = Math.max(30, Math.floor((size * maxWidth) / widest))
  const leading = Math.min(size * 1.9, (HEIGHT - 520) / Math.max(1, lines.length))

  let y = HEIGHT / 2 - ((lines.length - 1) * leading) / 2 - 20
  context.fillStyle = theme.ink
  context.font = `400 ${size}px ${family}`
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    context.fillText(line.text, WIDTH / 2, y)
    // Each verse ends with a small ornament, so two hemistichs read as one.
    if (line.kind === 'ajuz' && index < lines.length - 1) {
      context.fillStyle = theme.gold
      context.font = `400 ${Math.round(size * 0.4)}px ${family}`
      context.fillText('✦', WIDTH / 2, y + leading * 0.55)
      context.fillStyle = theme.ink
      context.font = `400 ${size}px ${family}`
    }
    y += leading
  }

  // Title above, poet below.
  if (options.title?.trim()) {
    context.fillStyle = theme.soft
    context.font = `700 34px ${family}`
    context.fillText(options.title.trim(), WIDTH / 2, 160)
  }
  context.fillStyle = theme.gold
  context.font = `400 30px ${family}`
  context.fillText('✦', WIDTH / 2, HEIGHT - 205)
  if (options.poet.trim()) {
    context.fillStyle = theme.soft
    context.font = `700 40px ${family}`
    context.fillText(options.poet.trim(), WIDTH / 2, HEIGHT - 150)
  }
  if (poem.meter.trim()) {
    context.fillStyle = theme.soft
    context.globalAlpha = 0.75
    context.font = `400 26px ${family}`
    context.fillText(poem.meter.trim(), WIDTH / 2, HEIGHT - 105)
    context.globalAlpha = 1
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('card-encode-failed'))), 'image/png')
  })
}
