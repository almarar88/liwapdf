import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib'
import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { mergeFields, fillTemplate, mergeDocuments } from '../../src/renderer/src/lib/documents/mailmerge'
import { inferCell } from '../../src/renderer/src/lib/documents/sheets'
import { inspectDocument } from '../../src/renderer/src/lib/pdf/inspect'
import { visualDiff } from '../../src/renderer/src/lib/pdf/visualdiff'

const suite: Suite = {
  name: 'documents',
  async run(check) {
    const eq = makeEq(check)
    const template = '<p>عزيزي {{ الاسم }}،</p><p>مبلغك {{المبلغ}} — {{email}}</p>'
    eq('fields found', mergeFields(template).join('|'), 'الاسم|المبلغ|email')
    eq('fill escapes and matches loosely', fillTemplate(template, { 'الاسم': 'أحمد <b>', 'المبلغ': '500', Email: 'a@b.c' }), '<p>عزيزي أحمد &lt;b&gt;،</p><p>مبلغك 500 — a@b.c</p>')
    const sheet = { name: 'S', rows: [['الاسم', 'المبلغ', 'email'], ['أحمد', '500', 'a@b.c'], ['سارة', '750', 's@b.c'], ['', '', ''], ['أحمد', '900', 'x@y.z']].map((r) => r.map((c) => inferCell(c))) }
    const docs = mergeDocuments(template, sheet, { nameField: 'الاسم', prefix: 'خطاب' })
    eq('three documents from three rows', docs.length, 3)
    eq('names unique', docs.map((d) => d.name).join('|'), 'خطاب - أحمد|خطاب - سارة|خطاب - أحمد (2)')
    check('second document filled', docs[1].html.includes('سارة') && docs[1].html.includes('750'))

    const a = await PDFDocument.create()
    const fa = await a.embedFont(StandardFonts.Helvetica)
    a.addPage([300, 300]).drawText('Same page', { x: 40, y: 250, size: 18, font: fa })
    a.addPage([300, 300]).drawText('Contract', { x: 40, y: 250, size: 18, font: fa })
    a.setTitle('Alcode Test')
    const b = await PDFDocument.create()
    const fb = await b.embedFont(StandardFonts.Helvetica)
    b.addPage([300, 300]).drawText('Same page', { x: 40, y: 250, size: 18, font: fb })
    const pb2 = b.addPage([300, 300])
    pb2.drawText('Contract', { x: 40, y: 250, size: 18, font: fb })
    pb2.drawRectangle({ x: 100, y: 100, width: 80, height: 40, color: rgb(0, 0, 0) })
    const aBytes = await a.save()
    const diff = await visualDiff(aBytes, await b.save(), { withImages: true })
    check('identical page unchanged', diff.pages[0].changed < 0.0005, String(diff.pages[0].changed))
    check('stamped page changed a few percent', diff.pages[1].changed > 0.02 && diff.pages[1].changed < 0.06, String(diff.pages[1].changed))
    eq('changed page count', diff.changedPages, 1)
    check('overlay image produced', Boolean(diff.pages[1].image?.startsWith('data:image/png')))

    const report = await inspectDocument(aBytes)
    eq('inspect pages', report.pages, 2)
    check('inspect font not embedded', report.fonts.some((f) => f.name === 'Helvetica' && !f.embedded), JSON.stringify(report.fonts))
    eq('inspect title', report.title, 'Alcode Test')
    eq('inspect not scanned', report.scanned, false)
  }
}
export default suite
