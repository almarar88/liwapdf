import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { extractTables } from '../../src/renderer/src/lib/pdf/tables'
import { imposeBooklet } from '../../src/renderer/src/lib/pdf/ops'
import { openForRender } from '../../src/renderer/src/lib/pdf/pdfjs'
import { extractText } from '../../src/renderer/src/lib/pdf/render'

const suite: Suite = {
  name: 'layout',
  async run(check) {
    const eq = makeEq(check)
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595, 842])
    page.drawText('Quarterly report', { x: 50, y: 800, size: 16, font })
    const columns = [50, 220, 330, 440]
    const rows = [
      ['Item', 'Qty', 'Price', 'Total'],
      ['Blue pen', '2', '1.5', '3'],
      ['Notebook A4', '10', '4.25', '42.5'],
      ['Stapler', '1', '12', '12']
    ]
    rows.forEach((row, r) => row.forEach((cell, c) => page.drawText(cell, { x: columns[c], y: 740 - r * 24, size: 11, font })))
    const proxy = await openForRender(await pdf.save())
    const tables = await extractTables(proxy)
    await proxy.destroy()
    eq('one table sheet', tables.length, 1)
    const grid = tables[0]?.rows ?? []
    eq('five rows', grid.length, 5)
    eq('four columns', grid[1]?.length, 4)
    eq('header row', grid[1]?.map((c) => c.text).join('|'), 'Item|Qty|Price|Total')
    eq('multi-word cell kept together', grid[3]?.[0]?.text, 'Notebook A4')
    check('numbers become numbers', grid[3]?.[3]?.value === 42.5, String(grid[3]?.[3]?.value))
    eq('title row in first column', grid[0]?.[0]?.text, 'Quarterly report')

    const book = await PDFDocument.create()
    const f = await book.embedFont(StandardFonts.Helvetica)
    for (let i = 1; i <= 6; i += 1) book.addPage([300, 400]).drawText(`P${i}`, { x: 130, y: 200, size: 24, font: f })
    const bookBytes = await book.save()
    const ltr = await openForRender(await imposeBooklet(bookBytes, [842, 595], false))
    const ltrText = (await extractText(ltr)).map((p) => p.lines.join(' '))
    eq('booklet sheets', ltr.numPages, 4)
    eq('outer side', ltrText[0], 'P1')
    eq('side 3', ltrText[2], 'P6 P3')
    eq('side 4', ltrText[3], 'P4 P5')
    await ltr.destroy()
    const rtl = await openForRender(await imposeBooklet(bookBytes, [842, 595], true))
    const rtlText = (await extractText(rtl)).map((p) => p.lines.join(' '))
    eq('rtl side 3 mirrored', rtlText[2], 'P3 P6')
    await rtl.destroy()
  }
}
export default suite
