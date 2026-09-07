import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, convertMillimetersToTwip } from 'docx'
import { type Suite, eq as makeEq, saveArtifact } from '../harness'
import { docxToRichHtml } from '../../src/renderer/src/lib/docx/ooxml'
import { buildPrintableHtml } from '../../src/renderer/src/lib/docx/print'

/**
 * Converting Word to PDF must reproduce the document, not restyle it: the
 * page Word declared, its margins, its fonts and sizes, and its own table
 * borders rather than a house style.
 */
const suite: Suite = {
  name: 'word-pdf',
  async run(check) {
    const eq = makeEq(check)
    const cell = (text: string, options: { bold?: boolean; fill?: string } = {}): TableCell =>
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        shading: options.fill ? { fill: options.fill } : undefined,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [new TextRun({ text, font: 'Sakkal Majalla', size: 24, bold: options.bold, rightToLeft: true })]
          })
        ]
      })

    const document = new Document({
      sections: [
        {
          properties: {
            // Letter paper with 25 mm / 30 mm margins: nothing like the A4
            // and 18 mm the exporter used to impose.
            page: {
              size: { width: convertMillimetersToTwip(216), height: convertMillimetersToTwip(279) },
              margin: {
                top: convertMillimetersToTwip(25),
                right: convertMillimetersToTwip(30),
                bottom: convertMillimetersToTwip(25),
                left: convertMillimetersToTwip(30)
              }
            },
            bidi: true
          },
          children: [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'عقد اتفاق', font: 'Sakkal Majalla', size: 48, color: '1F3864', bold: true, rightToLeft: true })]
            }),
            new Paragraph({
              alignment: AlignmentType.BOTH,
              bidirectional: true,
              indent: { firstLine: convertMillimetersToTwip(10) },
              spacing: { line: 360 },
              children: [new TextRun({ text: 'تحية طيبة وبعد، نفيدكم بأن العرض المرفق ساري.', font: 'Sakkal Majalla', size: 28, rightToLeft: true })]
            }),
            new Table({
              visuallyRightToLeft: true,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 12, color: '1F3864' },
                bottom: { style: BorderStyle.SINGLE, size: 12, color: '1F3864' },
                left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
                insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
              },
              rows: [
                new TableRow({ tableHeader: true, children: [cell('البند', { bold: true, fill: 'DEEAF6' }), cell('السعر', { bold: true, fill: 'DEEAF6' })] }),
                new TableRow({ children: [cell('خدمة الاستضافة'), cell('٤٥٠٠ ريال')] })
              ]
            })
          ]
        }
      ]
    })
    const bytes = new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer())
    const rich = await docxToRichHtml(bytes)

    // The page Word declared, in points: 216 mm = 612 pt, 279 mm = 792 pt.
    check('page width is the document\'s', Math.abs(rich.page.width - 612) < 2, String(rich.page.width))
    check('page height is the document\'s', Math.abs(rich.page.height - 792) < 2, String(rich.page.height))
    check('top margin kept', Math.abs(rich.page.margins.top - 25 * 2.8346) < 3, String(rich.page.margins.top))
    check('side margin kept', Math.abs(rich.page.margins.left - 30 * 2.8346) < 3, String(rich.page.margins.left))
    eq('portrait', rich.page.landscape, false)

    // Table borders are Word's own: a coloured rule top and bottom, none at
    // the sides, hairlines inside.
    check('table top border kept', /border-top:1\.5pt solid #1F3864/.test(rich.html), rich.html.slice(0, 400))
    check('table side border removed', /border-left:none/.test(rich.html), rich.html.slice(0, 400))
    check('inside rule kept', /border-bottom:0\.5pt solid #CCCCCC/.test(rich.html), rich.html.slice(0, 600))
    check('header cell shading kept', /background:#DEEAF6/.test(rich.html), rich.html.slice(0, 600))
    check('header row is a th', /<th /.test(rich.html), rich.html.slice(0, 600))
    check('column widths kept as shares', /<colgroup><col style="width:50%"><col style="width:50%">/.test(rich.html), rich.html.slice(0, 300))
    check('percentage table width', /<table style="border-collapse:collapse;width:100%"/.test(rich.html), rich.html.slice(0, 300))

    // The printable page must not fight the document's own formatting.
    const printable = buildPrintableHtml(rich.html, { title: 'contract', rightToLeft: true, page: rich.page })
    saveArtifact('word-print.html', new TextEncoder().encode(printable))
    saveArtifact(
      'word-page.json',
      new TextEncoder().encode(JSON.stringify({ page: rich.page, rtl: rich.direction === 'rtl' }))
    )
    check('no forced body pixel size', !/font-size: \d+px/.test(printable), printable.slice(0, 900))
    check('no forced full-width tables', !/table \{[^}]*width: 100%/.test(printable), printable.slice(0, 1200))
    check('no house cell borders', !/th, td \{[^}]*border: 1px/.test(printable), printable.slice(0, 1200))
    check('heading rules are fallbacks only', printable.includes(':where(h1, h2, h3, h4, h5, h6)'), printable.slice(0, 1400))
    check('word line height, not the reader\'s', /line-height: 1\.15/.test(printable), printable.slice(0, 900))

    // The sanitiser stands between the reader and the printer; it must not
    // strip the very formatting this conversion exists to keep.
    const { sanitizeForPrint } = await import('../../src/renderer/src/lib/documents/sanitize')
    const { sanitize } = await import('../../src/renderer/src/lib/documents/sanitize')
    for (const [name, clean] of [
      ['print sanitiser', sanitizeForPrint(rich.html)],
      ['editor sanitiser', sanitize(rich.html)]
    ] as [string, string][]) {
      check(`${name} keeps fonts`, clean.includes("font-family:'Sakkal Majalla'"), clean.slice(0, 300))
      check(`${name} keeps sizes`, /font-size:\s*24pt/.test(clean), clean.slice(0, 300))
      check(`${name} keeps colours`, /color:\s*(#1F3864|rgb\(31, 56, 100\))/i.test(clean), clean.slice(0, 300))
      check(`${name} keeps table borders`, /border-top:\s*1\.5pt solid/.test(clean), clean.slice(0, 900))
      check(`${name} keeps column widths`, /<colgroup>/.test(clean), clean.slice(0, 300))
      check(`${name} keeps direction`, /dir="rtl"/.test(clean), clean.slice(0, 200))
    }

    // The narrow URI rule must keep exempting plain attributes while still
    // stripping the references it exists to stop.
    const merged = sanitizeForPrint('<table><tr><td colspan="3" rowspan="2" dir="rtl">x</td></tr></table>')
    check('merged cells survive', /colspan="3"/.test(merged) && /rowspan="2"/.test(merged), merged)
    const remote = sanitizeForPrint('<p><img src="https://example.com/a.png"><a href="https://example.com">x</a></p>')
    check('remote references still stripped', !remote.includes('example.com'), remote)

    // A plain HTML conversion still gets the readable house style.
    const plain = buildPrintableHtml('<p>Hello</p>', { title: 'x', rightToLeft: false })
    check('house style still applies without a page', /font-size: 15px/.test(plain) && /width: 100%/.test(plain), plain.slice(0, 900))
  }
}

export default suite
