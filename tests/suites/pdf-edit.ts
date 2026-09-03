import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib'
import { type Suite, eq as makeEq, saveArtifact } from '../harness'
import { pdfToDocument } from '../../src/renderer/src/lib/pdf/toDocument'

/** A PDF read back into an editable document keeps its structure. */
const suite: Suite = {
  name: 'pdf-edit',
  async run(check) {
    const eq = makeEq(check)
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const bold = await document.embedFont(StandardFonts.HelveticaBold)
    const page = document.addPage([595, 842])
    const title = 'Annual Report'
    // Centred the way a word processor centres it, so the reader has to
    // recognise the centring rather than a happy accident.
    page.drawText(title, { x: (595 - bold.widthOfTextAtSize(title, 28)) / 2, y: 760, size: 28, font: bold, color: rgb(0.1, 0.2, 0.5) })
    page.drawText('Section one', { x: 60, y: 700, size: 18, font: bold })
    page.drawText('The first line of the body paragraph runs here', { x: 60, y: 660, size: 12, font })
    page.drawText('and the second line continues underneath it.', { x: 60, y: 645, size: 12, font })
    page.drawText('A separate paragraph after a wider gap.', { x: 60, y: 590, size: 12, font })
    const second = document.addPage([595, 842])
    second.drawText('Page two body text.', { x: 60, y: 700, size: 12, font })
    const bytes = await document.save()

    const result = await pdfToDocument(bytes, 2)
    saveArtifact('pdf-to-document.html', new TextEncoder().encode(result.html))
    eq('pages read', result.pages, 2)
    check('title became a heading', /<h1[^>]*>Annual Report<\/h1>/.test(result.html), result.html)
    check('section became a smaller heading', /<h[23][^>]*>Section one<\/h[23]>/.test(result.html), result.html)
    check('body lines joined into one paragraph', /<p[^>]*>The first line of the body paragraph runs here and the second line continues underneath it\.<\/p>/.test(result.html), result.html)
    check('separate paragraph kept separate', result.html.includes('A separate paragraph after a wider gap.'), result.html)
    check('body size carried', /font-size:12pt/.test(result.html), result.html)
    check('centred title detected', /<h1[^>]*text-align:center/.test(result.html), result.html)
    check('page break between pages', result.html.includes('page-break-before:always'), result.html)
    check('second page present', result.html.includes('Page two body text.'), result.html)
    eq('document direction', result.direction, 'ltr')

    // An Arabic page comes back right-to-left, and the paragraph keeps its script.
    const arabicDoc = await PDFDocument.create()
    const arabicPage = arabicDoc.addPage([595, 842])
    const { prepareFonts, drawSmartText } = await import('../../src/renderer/src/lib/pdf/typography')
    const fonts = await prepareFonts(arabicDoc)
    await drawSmartText(arabicPage, fonts, 'تقرير سنوي', 380, 760, { size: 26, color: '#000000', rtl: true })
    await drawSmartText(arabicPage, fonts, 'هذه فقرة عربية داخل المستند.', 300, 700, { size: 13, color: '#000000', rtl: true })
    const arabic = await pdfToDocument(await arabicDoc.save(), 1)
    eq('arabic document direction', arabic.direction, 'rtl')
    check('arabic paragraphs marked rtl', (arabic.html.match(/dir="rtl"/g) ?? []).length >= 2, arabic.html)
  }
}

export default suite
