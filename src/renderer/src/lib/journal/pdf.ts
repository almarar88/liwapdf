import { PDFDocument, type PDFPage } from '@cantoo/pdf-lib'
import {
  drawSmartText,
  measureSmartText,
  prepareFonts,
  toArabicIndicDigits,
  wrapSmartText,
  type FontSet
} from '../pdf/typography'
import { formatGregorian, formatHijri } from '../format'
import {
  GOLD,
  INK,
  SOFT,
  FRAME,
  drawAligned,
  drawFrame,
  drawOrnament,
  drawVerse,
  fitSize,
  hex,
  layoutFor,
  type Layout
} from '../diwan/pdf'
import { filledVerses, poemLabel, type Poem } from '../diwan/types'
import { MOODS, type JournalEntry } from './types'

/**
 * The memoir: a year of days as a bound book.
 *
 * Each month opens with its name; each day carries its date in both
 * calendars, the title if one was given, the text as paragraphs, and the
 * poems said that day laid out as they are in the diwan — because a poem
 * written on a night belongs on that night's page, not only in the diwan.
 */

export interface MemoirPdfOptions {
  title: string
  author: string
  language: 'ar' | 'en'
  cover: boolean
  index: boolean
  includePoems: boolean
  pageSize?: 'A4' | 'A5' | 'Letter'
  /** Inclusive ISO dates; empty means everything. */
  from?: string
  to?: string
}

const MOOD_LABELS: Record<string, { ar: string; en: string }> = {
  joy: { ar: 'فرح', en: 'Joy' },
  calm: { ar: 'هدوء', en: 'Calm' },
  grateful: { ar: 'امتنان', en: 'Grateful' },
  tired: { ar: 'تعب', en: 'Tired' },
  sad: { ar: 'حزن', en: 'Sad' },
  anxious: { ar: 'قلق', en: 'Anxious' },
  angry: { ar: 'غضب', en: 'Angry' },
  inspired: { ar: 'إلهام', en: 'Inspired' }
}

export async function renderMemoirPdf(
  entries: JournalEntry[],
  poems: Map<string, Poem>,
  options: MemoirPdfOptions
): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.setTitle(options.title || 'Memoir')
  if (options.author) document.setAuthor(options.author)
  document.setProducer('Alcode Editor')
  document.setCreator('Alcode Editor')

  const fonts = await prepareFonts(document)
  const layout = layoutFor(options.pageSize)
  const rtl = options.language === 'ar'
  const digits = (value: number): string => (rtl ? toArabicIndicDigits(value) : String(value))
  const width = layout.right - layout.left

  const chosen = entries
    .filter((entry) => !entry.deletedAt)
    .filter((entry) => (!options.from || entry.day >= options.from) && (!options.to || entry.day <= options.to))
    .sort((a, b) => a.day.localeCompare(b.day))

  const pages: PDFPage[] = []
  const newPage = (): PDFPage => {
    const page = document.addPage([layout.width, layout.height])
    pages.push(page)
    drawFrame(page, layout)
    return page
  }

  if (options.cover) await drawCover(newPage(), fonts, layout, options)
  const indexPage = options.index && chosen.length > 0 ? newPage() : null
  const months: { label: string; page: number }[] = []

  let page: PDFPage | null = null
  let y = layout.top
  let currentMonth = ''
  const body = 11
  const line = body * 1.85

  const ensure = (needed: number): void => {
    if (!page || y - needed < layout.bottom) {
      page = newPage()
      y = layout.top
    }
  }

  for (const entry of chosen) {
    const date = new Date(`${entry.day}T12:00:00`)
    const month = monthLabel(date, options.language)
    if (month !== currentMonth) {
      currentMonth = month
      page = newPage()
      y = layout.top - 40
      months.push({ label: month, page: pages.length })
      await drawAligned(page, fonts, month, layout.center, y, { size: 24, color: INK, bold: true, rtl }, 'center')
      y -= 26
      drawOrnament(page, layout.center, y + 2, 9)
      y -= 44
    }

    ensure(line * 4)
    const current = page as PDFPage
    // The day: weekday and date, in both calendars.
    const dayLine = `${formatGregorian(date, options.language)}  ·  ${formatHijri(date, options.language)}`
    await drawAligned(current, fonts, dayLine, rtl ? layout.right : layout.left, y, { size: 9.5, color: GOLD, rtl }, rtl ? 'right' : 'left')
    y -= 18

    const mood = MOOD_LABELS[entry.mood]?.[options.language]
    const meta = [mood, entry.place.trim(), ...entry.tags.map((tag) => `#${tag}`)].filter(Boolean).join('  ·  ')
    if (entry.title.trim()) {
      const lines = await wrapSmartText(fonts, entry.title.trim(), width, { size: 15, color: INK, bold: true, rtl })
      for (const text of lines) {
        ensure(22)
        await drawAligned(page as PDFPage, fonts, text, rtl ? layout.right : layout.left, y, { size: 15, color: INK, bold: true, rtl }, rtl ? 'right' : 'left')
        y -= 22
      }
    }
    if (meta) {
      ensure(16)
      await drawAligned(page as PDFPage, fonts, meta, rtl ? layout.right : layout.left, y, { size: 9, color: SOFT, rtl }, rtl ? 'right' : 'left')
      y -= 18
    }

    for (const paragraph of entry.body.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
      const lines = await wrapSmartText(fonts, paragraph.replace(/\n/g, ' ').trim(), width, { size: body, color: INK, rtl })
      for (const text of lines) {
        if (!text) continue
        ensure(line)
        await drawAligned(page as PDFPage, fonts, text, rtl ? layout.right : layout.left, y, { size: body, color: INK, rtl }, rtl ? 'right' : 'left')
        y -= line
      }
      y -= line * 0.5
    }

    if (options.includePoems) {
      for (const poemId of entry.poemIds) {
        const poem = poems.get(poemId)
        if (!poem) continue
        const verses = filledVerses(poem)
        if (verses.length === 0) continue
        ensure(line * 4)
        y -= 6
        await drawAligned(page as PDFPage, fonts, poemLabel(poem, ''), layout.center, y, { size: 13, color: INK, bold: true, rtl: true }, 'center')
        y -= 20
        const size = await fitSize(fonts, verses, layout.column)
        const verseLine = size * 1.95
        for (const verse of verses) {
          ensure(verseLine)
          await drawVerse(page as PDFPage, fonts, layout, y, verse.sadr, verse.ajuz, size, poem.form === 'free')
          y -= verseLine
        }
        y -= 8
      }
    }

    // A small rule between days.
    ensure(24)
    ;(page as PDFPage).drawLine({
      start: { x: layout.center - 28, y: y + 6 },
      end: { x: layout.center + 28, y: y + 6 },
      thickness: 0.5,
      color: hex(GOLD)
    })
    y -= 26
  }

  if (indexPage) await drawMonthIndex(indexPage, fonts, layout, months, rtl)

  for (let position = 0; position < pages.length; position += 1) {
    if (options.cover && position === 0) continue
    const label = digits(position + 1)
    const measured = await measureSmartText(fonts, label, { size: 10, color: SOFT })
    await drawSmartText(pages[position], fonts, label, layout.center - measured.width / 2, FRAME + 12, { size: 10, color: SOFT })
  }

  return document.save({ useObjectStreams: true })
}

function monthLabel(date: Date, language: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA-u-nu-arab-ca-gregory' : 'en-GB', { month: 'long', year: 'numeric' }).format(date)
}

async function drawCover(page: PDFPage, fonts: FontSet, layout: Layout, options: MemoirPdfOptions): Promise<void> {
  const rtl = options.language === 'ar'
  let y = layout.height * 0.6
  drawOrnament(page, layout.center, y + 60, 14)
  const title = options.title.trim() || (rtl ? 'مذكرات' : 'Memoir')
  for (const text of await wrapSmartText(fonts, title, layout.right - layout.left - 40, { size: 30, color: INK, bold: true, rtl })) {
    await drawAligned(page, fonts, text, layout.center, y, { size: 30, color: INK, bold: true, rtl }, 'center')
    y -= 44
  }
  page.drawLine({ start: { x: layout.center - 60, y: y + 14 }, end: { x: layout.center + 60, y: y + 14 }, thickness: 0.8, color: hex(GOLD) })
  if (options.author.trim()) {
    await drawAligned(page, fonts, options.author.trim(), layout.center, y - 18, { size: 15, color: SOFT, rtl }, 'center')
  }
}

async function drawMonthIndex(page: PDFPage, fonts: FontSet, layout: Layout, months: { label: string; page: number }[], rtl: boolean): Promise<void> {
  let y = layout.top - 8
  await drawAligned(page, fonts, rtl ? 'الفهرس' : 'Contents', layout.center, y, { size: 19, color: INK, bold: true, rtl }, 'center')
  y -= 22
  drawOrnament(page, layout.center, y + 3, 8)
  y -= 30
  for (const month of months) {
    if (y < layout.bottom + 10) break
    const number = rtl ? toArabicIndicDigits(month.page) : String(month.page)
    await drawAligned(page, fonts, month.label, rtl ? layout.right : layout.left, y, { size: 11.5, color: INK, rtl }, rtl ? 'right' : 'left')
    await drawAligned(page, fonts, number, rtl ? layout.left : layout.right, y, { size: 11.5, color: SOFT }, rtl ? 'left' : 'right')
    y -= 23
  }
}
