import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { addHeaderFooter, addWatermark, expandDateTokens } from '../../src/renderer/src/lib/pdf/ops'
import { replaceText } from '../../src/renderer/src/lib/pdf/replace'
import { openForRender } from '../../src/renderer/src/lib/pdf/pdfjs'
import { extractText } from '../../src/renderer/src/lib/pdf/render'
import { formatGregorian, formatHijri } from '../../src/renderer/src/lib/format'

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const proxy = await openForRender(bytes)
  try {
    return (await extractText(proxy)).map((p) => p.lines.join(' '))
  } finally {
    await proxy.destroy()
  }
}

const suite: Suite = {
  name: 'pdf-text',
  async run(check) {
    const eq = makeEq(check)
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 3; i += 1) {
      const page = pdf.addPage([595, 842])
      page.drawText(`Body ${i + 1}`, { x: 60, y: 400, size: 24, font })
    }
    const bytes = await pdf.save()
    const today = new Date()

    // Header and footer tokens, digits following the text's script.
    const stamped = await addHeaderFooter(bytes, {
      header: 'Page {page} of {total} · {date}',
      footer: 'صفحة {page} من {total} — {hijri}',
      fontSize: 11,
      color: '#333333',
      margin: 24,
      align: 'center',
      indices: [0, 1, 2]
    })
    const pages = await textOf(stamped)
    check('english header page 2', pages[1].includes('Page 2 of 3'), pages[1])
    check('gregorian date present', pages[1].includes(formatGregorian(today, 'en')))
    check('arabic-indic page number', pages[1].includes('٢') && pages[1].includes('٣'), pages[1])
    const month = formatHijri(today, 'ar').split(' ').find((word) => word.length > 3 && !/[٠-٩]/.test(word)) ?? ''
    check('hijri date present', month.length > 0 && pages[1].includes(month), `${month} | ${pages[1]}`)
    check('no raw tokens left', !pages.join(' ').includes('{'))

    // Watermark date tokens.
    const expanded = expandDateTokens('مسودة {hijri}')
    check('watermark hijri token', !expanded.includes('{') && /هـ/.test(expanded), expanded)
    const wm = await addWatermark(bytes, { text: 'DRAFT {date}', fontSize: 30, color: '#999999', opacity: 0.5, rotation: 0, anchor: 'center', margin: 20, scale: 1, tile: false, bold: false, indices: [0] })
    const wmText = (await textOf(wm)).join(' ')
    check('watermark date expanded', wmText.includes('DRAFT') && !wmText.includes('{date}') && /20\d\d/.test(wmText), wmText)

    // Find and replace inside the PDF's own text.
    const doc = await PDFDocument.create()
    const f = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([595, 842])
    page.drawText('Hello World from Alcode', { x: 60, y: 700, size: 18, font: f })
    page.drawText('World peace', { x: 60, y: 650, size: 14, font: f })
    page.drawText('Untouched line', { x: 60, y: 600, size: 14, font: f })
    page.drawText('World — dashed', { x: 60, y: 550, size: 14, font: f })
    const result = await replaceText(await doc.save(), { find: 'World', replace: 'Everyone' })
    eq('three runs replaced', result.replaced, 3)
    eq('originals struck from the file', result.covered, 0)
    const after = (await textOf(result.bytes)).join(' ')
    check('replacement present', after.includes('Hello Everyone from Alcode') && after.includes('Everyone peace') && after.includes('Everyone — dashed'), after)
    check('old text gone', !after.includes('World'), after)
    check('other line untouched', after.includes('Untouched line'), after)
    const none = await replaceText(result.bytes, { find: 'Nothing here', replace: 'x' })
    eq('no match leaves bytes', none.replaced, 0)
    check('no match returns same bytes', none.bytes === result.bytes)
  }
}
export default suite
