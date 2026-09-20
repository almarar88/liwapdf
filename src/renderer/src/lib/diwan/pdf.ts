import { PDFDocument, rgb, type PDFPage } from '@cantoo/pdf-lib'
import {
  drawSmartText,
  measureSmartText,
  prepareFonts,
  toArabicIndicDigits,
  wrapSmartText,
  type FontSet
} from '../pdf/typography'
import { PAGE_PRESETS } from '../format'
import { filledVerses, poemLabel, type Poem } from './types'

/**
 * A diwan on paper.
 *
 * Printed poetry books share one page: the title over the meter, the verses
 * in two columns with the sadr on the right and the ajuz on the left, a
 * small ornament between the halves, a frame around the whole, and the
 * page number under it. Everything here is drawn as real vector text through
 * the embedded Amiri face, so the book is searchable, zoomable and prints
 * sharp — the same guarantee the rest of the app makes for Arabic.
 */

export interface DiwanPdfOptions {
  /** The book's title on the cover; the poet's name under it. */
  title: string
  poet: string
  language: 'ar' | 'en'
  cover: boolean
  index: boolean
  /** The occasion under each poem, when the poet wrote one. */
  occasions: boolean
  pageSize?: 'A4' | 'A5' | 'Letter'
  /** Every poem on its own page (a book) or flowing (a booklet of short ones). */
  pagePerPoem: boolean
}

const INK = '#1f1a14'
const SOFT = '#6f665a'
const GOLD = '#a8823f'
const MARGIN = 58
const FRAME = 26

interface Layout {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  center: number
  /** The widest a hemistich may be before the type shrinks. */
  column: number
}

function layoutFor(size: DiwanPdfOptions['pageSize']): Layout {
  const [width, height] = PAGE_PRESETS[size ?? 'A4'] ?? PAGE_PRESETS.A4
  const left = MARGIN
  const right = width - MARGIN
  const gap = 34
  return {
    width,
    height,
    left,
    right,
    top: height - MARGIN - 8,
    bottom: MARGIN + 6,
    center: width / 2,
    column: (right - left - gap) / 2
  }
}

export async function renderDiwanPdf(poems: Poem[], options: DiwanPdfOptions): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.setTitle(options.title || 'Diwan')
  if (options.poet) document.setAuthor(options.poet)
  document.setProducer('Alcode Editor')
  document.setCreator('Alcode Editor')

  const fonts = await prepareFonts(document)
  const layout = layoutFor(options.pageSize)
  const rtl = options.language === 'ar'
  const digits = (value: number): string => (rtl ? toArabicIndicDigits(value) : String(value))

  const pages: PDFPage[] = []
  const newPage = (): PDFPage => {
    const page = document.addPage([layout.width, layout.height])
    pages.push(page)
    drawFrame(page, layout)
    return page
  }

  // Cover and index are laid out first but the index needs the page numbers
  // of poems that come after it, so the poem pages are drawn, the numbers
  // recorded, and the index filled in at the end on the page reserved for it.
  if (options.cover) {
    const cover = newPage()
    await drawCover(cover, fonts, layout, options)
  }
  const indexPage = options.index && poems.length > 0 ? newPage() : null
  const entries: { title: string; page: number }[] = []

  let page: PDFPage | null = null
  let y = layout.top
  for (const poem of poems) {
    const verses = filledVerses(poem)
    if (verses.length === 0) continue
    const title = poemLabel(poem, rtl ? 'قصيدة' : 'Poem')
    if (options.pagePerPoem || !page || y < layout.top - 200) {
      page = newPage()
      y = layout.top
    } else {
      y -= 28
    }
    entries.push({ title, page: pages.length })

    const heading = await drawHeading(page, fonts, layout, y, poem, title, rtl)
    y = heading

    // One size for the whole poem: the longest hemistich decides it, so a
    // poem with one long line does not have one small line.
    const size = await fitSize(fonts, verses, layout.column)
    const lineHeight = size * 1.95

    for (const verse of verses) {
      if (y - lineHeight < layout.bottom + 30) {
        page = newPage()
        y = layout.top - 6
      }
      await drawVerse(page, fonts, layout, y, verse.sadr, verse.ajuz, size, poem.form === 'free')
      y -= lineHeight
    }

    if (options.occasions && poem.occasion.trim()) {
      y -= 8
      const noteSize = 9.5
      const lines = await wrapSmartText(fonts, poem.occasion.trim(), layout.right - layout.left - 40, {
        size: noteSize,
        color: SOFT,
        rtl
      })
      const needed = lines.length * noteSize * 1.7 + 18
      if (y - needed < layout.bottom) {
        page = newPage()
        y = layout.top - 6
      }
      page.drawLine({
        start: { x: layout.center - 40, y: y + 2 },
        end: { x: layout.center + 40, y: y + 2 },
        thickness: 0.6,
        color: hex(GOLD)
      })
      y -= 16
      for (const line of lines) {
        await drawAligned(page, fonts, line, rtl ? layout.right - 20 : layout.left + 20, y, {
          size: noteSize,
          color: SOFT,
          rtl
        }, rtl ? 'right' : 'left')
        y -= noteSize * 1.7
      }
    }
  }

  if (indexPage) await drawIndex(indexPage, fonts, layout, entries, rtl)

  // Page numbers last, once the count is known; the cover carries none.
  for (let position = 0; position < pages.length; position += 1) {
    if (options.cover && position === 0) continue
    const label = digits(position + 1)
    const { width } = await measureSmartText(fonts, label, { size: 10, color: SOFT })
    await drawSmartText(pages[position], fonts, label, layout.center - width / 2, FRAME + 12, {
      size: 10,
      color: SOFT
    })
  }

  return document.save({ useObjectStreams: true })
}

/* ------------------------------------------------------------------ parts */

function hex(color: string): ReturnType<typeof rgb> {
  const clean = color.replace('#', '')
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  )
}

/**
 * The four-pointed star between the hemistichs, as a vector shape. It is
 * a shape and not the ✦ character because the embedded face has no glyph
 * for it, and a substitution box on every verse is not an ornament.
 */
function drawOrnament(page: PDFPage, x: number, y: number, size: number): void {
  page.drawSvgPath('M0 -1 L0.22 -0.22 L1 0 L0.22 0.22 L0 1 L-0.22 0.22 L-1 0 L-0.22 -0.22 Z', {
    x,
    y,
    scale: size / 2,
    color: hex(GOLD),
    borderWidth: 0
  })
}

/** A double hairline frame, the outer heavier, the way bound diwans are ruled. */
function drawFrame(page: PDFPage, layout: Layout): void {
  page.drawRectangle({
    x: FRAME,
    y: FRAME,
    width: layout.width - FRAME * 2,
    height: layout.height - FRAME * 2,
    borderColor: hex(GOLD),
    borderWidth: 1.1
  })
  page.drawRectangle({
    x: FRAME + 4,
    y: FRAME + 4,
    width: layout.width - FRAME * 2 - 8,
    height: layout.height - FRAME * 2 - 8,
    borderColor: hex(GOLD),
    borderWidth: 0.4
  })
}

async function drawAligned(
  page: PDFPage,
  fonts: FontSet,
  text: string,
  anchor: number,
  y: number,
  options: { size: number; color: string; bold?: boolean; rtl?: boolean },
  align: 'left' | 'right' | 'center'
): Promise<number> {
  if (!text) return 0
  const { width } = await measureSmartText(fonts, text, options)
  const x = align === 'right' ? anchor - width : align === 'center' ? anchor - width / 2 : anchor
  await drawSmartText(page, fonts, text, x, y, options)
  return width
}

async function drawCover(page: PDFPage, fonts: FontSet, layout: Layout, options: DiwanPdfOptions): Promise<void> {
  const rtl = options.language === 'ar'
  let y = layout.height * 0.6
  drawOrnament(page, layout.center, y + 60, 14)
  const title = options.title.trim() || (rtl ? 'ديوان' : 'Diwan')
  const lines = await wrapSmartText(fonts, title, layout.right - layout.left - 40, { size: 30, color: INK, bold: true, rtl })
  for (const line of lines) {
    await drawAligned(page, fonts, line, layout.center, y, { size: 30, color: INK, bold: true, rtl }, 'center')
    y -= 44
  }
  page.drawLine({
    start: { x: layout.center - 60, y: y + 14 },
    end: { x: layout.center + 60, y: y + 14 },
    thickness: 0.8,
    color: hex(GOLD)
  })
  if (options.poet.trim()) {
    await drawAligned(page, fonts, options.poet.trim(), layout.center, y - 18, { size: 15, color: SOFT, rtl }, 'center')
  }
  const year = new Date().getFullYear()
  await drawAligned(
    page,
    fonts,
    rtl ? toArabicIndicDigits(year) : String(year),
    layout.center,
    layout.bottom + 30,
    { size: 10.5, color: SOFT },
    'center'
  )
}

async function drawHeading(
  page: PDFPage,
  fonts: FontSet,
  layout: Layout,
  top: number,
  poem: Poem,
  title: string,
  rtl: boolean
): Promise<number> {
  let y = top - 6
  const lines = await wrapSmartText(fonts, title, layout.right - layout.left - 20, { size: 19, color: INK, bold: true, rtl })
  for (const line of lines) {
    await drawAligned(page, fonts, line, layout.center, y, { size: 19, color: INK, bold: true, rtl }, 'center')
    y -= 27
  }
  const meta = [poem.meter.trim(), poem.purpose.trim(), poem.rhyme.trim() ? (rtl ? `قافية ${poem.rhyme.trim()}` : `rhyme ${poem.rhyme.trim()}`) : '']
    .filter(Boolean)
    .join(rtl ? ' · ' : ' · ')
  if (meta) {
    await drawAligned(page, fonts, meta, layout.center, y + 4, { size: 10, color: SOFT, rtl }, 'center')
    y -= 16
  }
  drawOrnament(page, layout.center, y + 2, 8)
  return y - 30
}

async function fitSize(fonts: FontSet, verses: { sadr: string; ajuz: string }[], column: number): Promise<number> {
  const probe = 14
  let widest = 0
  for (const verse of verses) {
    for (const half of [verse.sadr, verse.ajuz]) {
      if (!half.trim()) continue
      const { width } = await measureSmartText(fonts, half.trim(), { size: probe, color: INK })
      widest = Math.max(widest, width)
    }
  }
  if (widest === 0) return probe
  return Math.max(9.5, Math.min(probe, (probe * column) / widest))
}

/**
 * The classical row: sadr flush to the right margin, ajuz flush to the left,
 * the ornament between them on the page's axis. A free-verse line simply
 * hangs from the right margin, as a line of prose would.
 */
async function drawVerse(
  page: PDFPage,
  fonts: FontSet,
  layout: Layout,
  y: number,
  sadr: string,
  ajuz: string,
  size: number,
  free: boolean
): Promise<void> {
  const ink = { size, color: INK, rtl: true }
  if (free) {
    await drawAligned(page, fonts, sadr.trim() || ajuz.trim(), layout.right, y, ink, 'right')
    return
  }
  if (sadr.trim()) await drawAligned(page, fonts, sadr.trim(), layout.right, y, ink, 'right')
  if (ajuz.trim()) await drawAligned(page, fonts, ajuz.trim(), layout.left, y, ink, 'left')
  if (sadr.trim() && ajuz.trim()) drawOrnament(page, layout.center, y + size * 0.3, size * 0.42)
}

async function drawIndex(
  page: PDFPage,
  fonts: FontSet,
  layout: Layout,
  entries: { title: string; page: number }[],
  rtl: boolean
): Promise<void> {
  let y = layout.top - 8
  await drawAligned(page, fonts, rtl ? 'الفهرس' : 'Contents', layout.center, y, { size: 19, color: INK, bold: true, rtl }, 'center')
  y -= 22
  drawOrnament(page, layout.center, y + 3, 8)
  y -= 30
  const size = 11.5
  for (const entry of entries) {
    if (y < layout.bottom + 10) break
    const number = rtl ? toArabicIndicDigits(entry.page) : String(entry.page)
    const titleAnchor = rtl ? layout.right : layout.left
    const numberAnchor = rtl ? layout.left : layout.right
    const titleWidth = await drawAligned(page, fonts, entry.title, titleAnchor, y, { size, color: INK, rtl }, rtl ? 'right' : 'left')
    const numberWidth = await drawAligned(page, fonts, number, numberAnchor, y, { size, color: SOFT }, rtl ? 'left' : 'right')
    // A dotted leader between the two, the way a contents page reads.
    const from = rtl ? layout.left + numberWidth + 8 : layout.left + titleWidth + 8
    const to = rtl ? layout.right - titleWidth - 8 : layout.right - numberWidth - 8
    if (to - from > 12) {
      page.drawLine({
        start: { x: from, y: y + 2 },
        end: { x: to, y: y + 2 },
        thickness: 0.5,
        color: hex('#c9bda6'),
        dashArray: [1, 3]
      })
    }
    y -= size * 2
  }
}
