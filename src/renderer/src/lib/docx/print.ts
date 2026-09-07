import { escapeHtml } from '../format'
import type { PageSetup } from './ooxml'

export interface PrintDocumentOptions {
  title?: string
  rightToLeft: boolean
  fontFamily?: string
  fontSize?: number
  /**
   * The source document's page. When present the stylesheet steps back: the
   * document carries its own fonts, sizes and spacing, and the printer
   * applies the margins, so nothing here may contradict them.
   */
  page?: PageSetup
}

/**
 * Wraps editor/Word HTML in a print-ready page. The offscreen Chromium window
 * in the main process renders exactly this, so all layout decisions for
 * generated PDFs live here.
 *
 * Two jobs, and they pull in opposite directions. Content the app itself
 * produced (a plain HTML file, a converted note) has no styling of its own
 * and needs a readable house style. A Word document arrives already styled
 * down to the point size, and every rule here that is not a fallback
 * *destroys* that: forcing 15px body text, a 1.75 line height and full-width
 * bordered tables is exactly how a careful letter turns into something the
 * author does not recognise. So when the caller passes the document's own
 * page, the rules become fallbacks — `:where()` costs no specificity, so any
 * inline style the reader carried across wins — and the house table styling
 * is dropped entirely, since the reader emits Word's real borders.
 */
export function buildPrintableHtml(body: string, options: PrintDocumentOptions): string {
  const direction = options.rightToLeft ? 'rtl' : 'ltr'
  const language = options.rightToLeft ? 'ar' : 'en'
  const faithful = Boolean(options.page)
  const font =
    options.fontFamily ??
    (options.rightToLeft
      ? "'SF Arabic', 'Geeza Pro', 'Dubai', 'Segoe UI', 'Noto Naskh Arabic', serif"
      : "'Calibri', 'Segoe UI', -apple-system, Helvetica, Arial, sans-serif")
  // A named font the machine lacks would silently become the default face;
  // appending a fallback chain keeps Arabic Arabic and serif serif.
  const fallback = options.rightToLeft
    ? "'Sakkal Majalla', 'Traditional Arabic', 'Simplified Arabic', 'Noto Naskh Arabic', 'Segoe UI', serif"
    : "'Calibri', 'Segoe UI', Helvetica, Arial, sans-serif"

  const house = `
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 2em; margin-top: 0; }
  h2 { font-size: 1.55em; }
  h3 { font-size: 1.25em; }
  p { margin: 0 0 0.85em; orphans: 3; widows: 3; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #c8ccd4; padding: 7px 10px; text-align: start; vertical-align: top; }
  th { background: #f2f3f7; font-weight: 600; }`

  // Word's own measurements, kept: headings and paragraphs take their size
  // from the runs the reader wrote, and only the gaps Word leaves implicit
  // are supplied here.
  const faithfulStyle = `
  :where(h1, h2, h3, h4, h5, h6) { margin: 0.6em 0 0.3em; line-height: 1.2; page-break-after: avoid; }
  :where(p) { margin: 0; orphans: 2; widows: 2; }
  :where(td, th) { padding: 2pt 5pt; vertical-align: top; }
  :where(th) { font-weight: 600; }
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  /* The reader marks a hard page break as its own empty paragraph. */
  p[style*="page-break-before"] { margin: 0; height: 0; }`

  // Chromium honours the printer's margins only while the page itself does
  // not declare any; `@page { margin: 0 }` silently discarded the document's.
  // With the page written into the CSS — and the printer told to prefer it —
  // the PDF comes out on the paper Word asked for, margins and all.
  const round = (value: number): number => Math.round(value * 100) / 100
  const pageRule = options.page
    ? `@page { size: ${round(options.page.width)}pt ${round(options.page.height)}pt; margin: ${round(
        options.page.margins.top
      )}pt ${round(options.page.margins.right)}pt ${round(options.page.margins.bottom)}pt ${round(
        options.page.margins.left
      )}pt; }`
    : '@page { margin: 0; }'

  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.title ?? 'Document')}</title>
<style>
  ${pageRule}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${faithful ? fallback : font};
    ${faithful ? 'font-size: 11pt;' : `font-size: ${options.fontSize ?? 15}px;`}
    line-height: ${faithful ? '1.15' : '1.75'};
    color: #14161c;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  ${faithful ? faithfulStyle : house}
  ul, ol { margin: 0 0 0.85em; padding-inline-start: 1.7em; }
  li { margin-bottom: 0.3em; }
  blockquote {
    margin: 1em 0; padding-inline-start: 1em;
    border-inline-start: 3px solid #d6d9e0; color: #4a5160;
  }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #d6d9e0; margin: 1.4em 0; }
  a { color: ${faithful ? 'inherit' : '#0a60c8'}; }
  code, pre { font-family: 'Consolas', 'SF Mono', monospace; font-size: 0.92em; }
  pre { background: #f4f5f8; padding: 12px 14px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
  .page-break { page-break-after: always; break-after: page; height: 0; }
</style>
</head>
<body>${body}</body>
</html>`
}

/** Renders a plain-text file as a monospace PDF-ready page. */
export function buildPlainTextHtml(text: string, options: PrintDocumentOptions): string {
  return buildPrintableHtml(
    `<pre style="white-space: pre-wrap; word-break: break-word; background: none; padding: 0;">${escapeHtml(
      text
    )}</pre>`,
    options
  )
}
