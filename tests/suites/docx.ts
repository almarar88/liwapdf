import { AlignmentType, Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { type Suite, eq as makeEq } from '../harness'
import { docxToRichHtml } from '../../src/renderer/src/lib/docx/ooxml'
import { htmlToDocx } from '../../src/renderer/src/lib/docx/write'

/**
 * A Word file keeps its fonts, sizes, colours, alignment and direction on
 * the way into the editor and on the way back out.
 */
const suite: Suite = {
  name: 'docx',
  async run(check) {
    const eq = makeEq(check)
    const document = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Quarterly report' })] }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              bidirectional: true,
              children: [
                new TextRun({ text: 'تقرير الربع الأول ', font: 'Sakkal Majalla', size: 32, color: 'C00000', bold: true, rightToLeft: true }),
                new TextRun({ text: 'بالتفصيل', font: 'Traditional Arabic', size: 28, rightToLeft: true })
              ]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Centered English', font: 'Georgia', size: 24, italics: true, underline: {} })]
            })
          ]
        }
      ]
    })
    // Packer.toBuffer wants Node's Buffer; in the renderer a blob is the way.
    const bytes = new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer())
    const result = await docxToRichHtml(bytes)
    const html = result.html
    check('heading kept', /<h1[^>]*>.*Quarterly report.*<\/h1>/.test(html), html)
    check('heading style colour kept', /<h1[^>]*>[^<]*<span style="[^"]*color:#2E74B5/.test(html), html)
    check('arabic font kept', html.includes("font-family:'Sakkal Majalla'"), html)
    check('second arabic font kept', html.includes("font-family:'Traditional Arabic'"), html)
    check('size in points', html.includes('font-size:16pt') && html.includes('font-size:14pt'), html)
    check('colour kept', html.includes('color:#C00000'), html)
    check('bold kept', html.includes('<strong>تقرير الربع الأول </strong>'), html)
    check('right alignment and direction', /<p dir="rtl" style="text-align:right"/.test(html), html)
    check('centered english', /<p dir="ltr" style="text-align:center"/.test(html), html)
    check('italic and underline', html.includes('<u><em>Centered English</em></u>'), html)
    // Mixed document: the script carrying more letters wins.
    eq('mixed document direction', result.direction, 'ltr')

    // A document whose section is marked bidi is right-to-left whatever it holds.
    const arabicDoc = new Document({
      sections: [
        {
          properties: { bidi: true },
          children: [new Paragraph({ bidirectional: true, children: [new TextRun({ text: 'خطاب رسمي', rightToLeft: true })] })]
        }
      ]
    })
    const arabicResult = await docxToRichHtml(new Uint8Array(await (await Packer.toBlob(arabicDoc)).arrayBuffer()))
    eq('bidi section is rtl', arabicResult.direction, 'rtl')

    // Round trip: what the reader produced, the writer keeps.
    const back = await htmlToDocx(html, { rightToLeft: true, title: 'x' } as never)
    const again = await docxToRichHtml(back)
    check('round trip keeps arabic font', again.html.includes("font-family:'Sakkal Majalla'"), again.html)
    check('round trip keeps size', again.html.includes('font-size:16pt'), again.html)
    check('round trip keeps alignment', /text-align:right/.test(again.html), again.html)
  }
}

export default suite
