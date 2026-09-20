import { escapeHtml } from '../format'
import { filledVerses, fontFamilyFor, poemLabel, styleOf, type Poem } from './types'
import { poemToText } from './parse'

/**
 * The poem in the formats people actually send: a Word file for the
 * publisher or the family group, plain text for a chat, and the same
 * two-column page for the whole diwan. All of it is the markup the app's
 * own converters already understand.
 */

const PAGE_STYLE = "font-family:'Amiri','Sakkal Majalla','Traditional Arabic',serif;line-height:1.9"

/** The two-column table the rich editor and the DOCX writer both lay out. */
export function poemHtml(poem: Poem, poet: string, options: { heading?: boolean } = {}): string {
  const rows = filledVerses(poem)
    .map((verse) =>
      poem.form === 'free'
        ? `<tr><td colspan="3" style="text-align:right">${escapeHtml(verse.sadr.trim() || verse.ajuz.trim())}</td></tr>`
        : `<tr><td style="text-align:right;width:47%">${escapeHtml(verse.sadr.trim())}</td>` +
          `<td style="text-align:center;width:6%;color:#a8823f">✦</td>` +
          `<td style="text-align:left;width:47%">${escapeHtml(verse.ajuz.trim())}</td></tr>`
    )
    .join('')
  const title = options.heading === false ? '' : `<h2 style="text-align:center">${escapeHtml(poemLabel(poem, ''))}</h2>`
  const meta = [poem.meter.trim(), poem.purpose.trim(), poem.rhyme.trim() ? `قافية ${poem.rhyme.trim()}` : ''].filter(Boolean).join(' · ')
  const line = meta ? `<p style="text-align:center;color:#6f665a">${escapeHtml(meta)}</p>` : ''
  const note = poem.occasion.trim() ? `<p style="color:#6f665a;font-size:0.9em">${escapeHtml(poem.occasion.trim())}</p>` : ''
  const sign = poet.trim() ? `<p style="text-align:center;color:#a8823f">— ${escapeHtml(poet.trim())}</p>` : ''
  return `<section dir="rtl" style="${PAGE_STYLE}">${title}${line}<table style="width:100%;border-collapse:collapse">${rows}</table>${note}${sign}</section>`
}

export function diwanHtml(poems: Poem[], title: string, poet: string): string {
  const cover = `<h1 style="text-align:center;font-size:2em;margin-top:6em">${escapeHtml(title)}</h1>` +
    (poet.trim() ? `<p style="text-align:center;color:#6f665a">${escapeHtml(poet.trim())}</p>` : '')
  const pages = poems
    .filter((poem) => filledVerses(poem).length > 0)
    .map((poem) => `<div style="page-break-before:always"></div>${poemHtml(poem, '', {})}`)
    .join('')
  return `<div dir="rtl" style="${PAGE_STYLE}">${cover}${pages}<p style="text-align:center;color:#a8823f">✦</p></div>`
}

export function poemPlainText(poem: Poem, poet: string): string {
  const parts = [poemLabel(poem, ''), '', poemToText(poem)]
  if (poem.occasion.trim()) parts.push('', poem.occasion.trim())
  if (poet.trim()) parts.push('', `— ${poet.trim()}`)
  return parts.join('\n').trim() + '\n'
}

export async function poemDocx(poem: Poem, poet: string): Promise<Uint8Array> {
  const { htmlToDocx } = await import('../docx/write')
  return htmlToDocx(poemHtml(poem, poet), { title: poemLabel(poem, 'poem'), rightToLeft: true })
}

export async function diwanDocx(poems: Poem[], title: string, poet: string): Promise<Uint8Array> {
  const { htmlToDocx } = await import('../docx/write')
  return htmlToDocx(diwanHtml(poems, title, poet), { title, rightToLeft: true })
}

/**
 * The whole poem as one tall image, in the poem's own face and paper —
 * for a story, a group, or a frame. Height follows the verse count.
 */
export async function renderPoemPoster(poem: Poem, poet: string): Promise<Blob> {
  const style = styleOf(poem)
  const family = fontFamilyFor(style.font)
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await Promise.all([document.fonts.load(`700 60px ${family}`), document.fonts.load(`400 44px ${family}`)]).catch(() => undefined)
  }
  const themes = {
    paper: { back: ['#f6efe1', '#ead9bb'], ink: '#2a2118', soft: '#7d6a4f', gold: '#a8823f' },
    night: { back: ['#1c1a2a', '#0b0f17'], ink: '#f2ebdc', soft: '#b3a68c', gold: '#d2b06a' },
    ivory: { back: ['#fbfaf7', '#f1eee6'], ink: '#1f1f1f', soft: '#6b6b6b', gold: '#9a8a5a' },
    sage: { back: ['#eef3ec', '#cfdcc7'], ink: '#1f2a1e', soft: '#5f7059', gold: '#7f9b6e' },
    rose: { back: ['#fbf0ee', '#ebcfc8'], ink: '#2b1d1b', soft: '#8a6560', gold: '#b8776a' }
  } as const
  const theme = themes[style.theme]
  const verses = filledVerses(poem)
  const width = 1080
  const size = 46
  const leading = size * 1.85
  const gap = 28
  const top = 260
  const bodyHeight = verses.reduce((sum, verse) => sum + (verse.ajuz.trim() ? leading * 2 : leading) + gap, 0)
  const height = Math.max(1080, Math.round(top + bodyHeight + 300))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas-unavailable')
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, theme.back[0])
  gradient.addColorStop(1, theme.back[1])
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.strokeStyle = theme.gold
  context.lineWidth = 3
  context.strokeRect(48, 48, width - 96, height - 96)
  context.lineWidth = 1
  context.strokeRect(60, 60, width - 120, height - 120)
  context.direction = 'rtl'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  context.fillStyle = theme.ink
  context.font = `700 54px ${family}`
  context.fillText(poemLabel(poem, ''), width / 2, 150)
  const meta = [poem.meter.trim(), poem.purpose.trim()].filter(Boolean).join(' · ')
  if (meta) {
    context.fillStyle = theme.soft
    context.font = `400 28px ${family}`
    context.fillText(meta, width / 2, 205)
  }
  context.fillStyle = theme.gold
  context.font = `400 26px ${family}`
  context.fillText('✦', width / 2, 240)

  let y = top + 40
  context.font = `400 ${size}px ${family}`
  for (const verse of verses) {
    context.fillStyle = theme.ink
    context.font = `400 ${size}px ${family}`
    fitText(context, verse.sadr.trim() || verse.ajuz.trim(), width - 200, size, family)
    context.fillText(verse.sadr.trim() || verse.ajuz.trim(), width / 2, y)
    y += leading
    if (verse.ajuz.trim() && verse.sadr.trim()) {
      context.font = `400 ${size}px ${family}`
      fitText(context, verse.ajuz.trim(), width - 200, size, family)
      context.fillText(verse.ajuz.trim(), width / 2, y)
      y += leading
    }
    context.fillStyle = theme.gold
    context.font = `400 18px ${family}`
    context.fillText('✦', width / 2, y - leading / 2 + gap / 2 + 4)
    y += gap
  }

  if (poet.trim()) {
    context.fillStyle = theme.soft
    context.font = `700 38px ${family}`
    context.fillText(poet.trim(), width / 2, height - 130)
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('poster-encode-failed'))), 'image/png')
  })
}

/** Shrinks the font until the line fits, then leaves it set. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, family: string): void {
  let current = size
  while (current > 24 && context.measureText(text).width > maxWidth) {
    current -= 2
    context.font = `400 ${current}px ${family}`
  }
}
