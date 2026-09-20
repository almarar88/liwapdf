import type { Suite } from '../harness'
import { eq as makeEq, saveArtifact } from '../harness'
import { emptyEntry, entryExcerpt, entryHasContent, todayIso, wordCount } from '../../src/renderer/src/lib/journal/types'
import { renderMemoirPdf } from '../../src/renderer/src/lib/journal/pdf'
import { countStreak } from '../../src/renderer/src/views/journal/JournalView'
import { emptyPoem } from '../../src/renderer/src/lib/diwan/types'

const suite: Suite = {
  name: 'journal',
  async run(check) {
    const eq = makeEq(check)

    eq('today is an iso date', /^\d{4}-\d{2}-\d{2}$/.test(todayIso()), true)
    eq('word count', wordCount('  كلمة   ثانية\nثالثة '), 3)
    eq('empty entry has no content', entryHasContent(emptyEntry('e1')), false)
    const written = { ...emptyEntry('e2', '2026-03-01'), body: 'سطر أول\n\nسطر ثانٍ طويل' }
    eq('entry with body has content', entryHasContent(written), true)
    eq('excerpt is the first line', entryExcerpt(written), 'سطر أول')

    // Streak: today, yesterday, then a gap.
    const day = (offset: number): string => {
      const date = new Date('2026-03-10T12:00:00')
      date.setDate(date.getDate() - offset)
      return todayIso(date)
    }
    const entries = [day(0), day(1), day(2), day(4)].map((d, index) => ({ ...emptyEntry(`s${index}`, d), body: 'x' }))
    eq('streak counts consecutive days', countStreak(entries, day(0)), 3)
    eq('streak tolerates today not written yet', countStreak(entries.slice(1), day(0)), 2)
    eq('no streak after a gap', countStreak(entries.slice(3), day(0)), 0)

    // The memoir: cover, index, a month page with a linked poem.
    const poem = { ...emptyPoem('p1', 'v1'), title: 'ليلة السفر', verses: [{ id: 'v1', sadr: 'يا ليل طوّل', ajuz: 'والصبح ما جاء' }] }
    const first = { ...emptyEntry('m1', '2026-02-03'), title: 'يوم هادئ', body: 'قضيت اليوم في البيت.\n\nقرأت قليلاً وكتبت هذا البيت.', mood: 'calm', tags: ['بيت'], poemIds: ['p1'] }
    const second = { ...emptyEntry('m2', '2026-03-08'), body: 'سفر إلى الرياض.', place: 'الرياض' }
    const bytes = await renderMemoirPdf([second, first], new Map([['p1', poem]]), {
      title: 'مذكرات التجربة',
      author: 'كاتب',
      language: 'ar',
      cover: true,
      index: true,
      includePoems: true,
      pageSize: 'A5'
    })
    saveArtifact('memoir.pdf', bytes)
    check('memoir pdf is a pdf', bytes.length > 2000 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const loaded = await PDFDocument.load(bytes)
    eq('memoir pages: cover, index, two months', loaded.getPageCount(), 4)
    eq('memoir title', loaded.getTitle(), 'مذكرات التجربة')
    eq('memoir range filter', (await PDFDocument.load(await renderMemoirPdf([second, first], new Map(), { title: 'x', author: '', language: 'en', cover: false, index: false, includePoems: false, from: '2026-03-01' }))).getPageCount(), 1)
  }
}
export default suite
