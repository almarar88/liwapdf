import { escapeHtml } from '../format'

export interface PrintDocumentOptions {
  title?: string
  rightToLeft: boolean
  fontFamily?: string
  fontSize?: number
}

/**
 * Wraps editor/Word HTML in a print-ready page. The offscreen Chromium window
 * in the main process renders exactly this, so all layout decisions for
 * generated PDFs live here.
 */
export function buildPrintableHtml(body: string, options: PrintDocumentOptions): string {
  const direction = options.rightToLeft ? 'rtl' : 'ltr'
  const language = options.rightToLeft ? 'ar' : 'en'
  const font =
    options.fontFamily ??
    (options.rightToLeft
      ? "'SF Arabic', 'Geeza Pro', 'Dubai', 'Segoe UI', 'Noto Naskh Arabic', serif"
      : "'Calibri', 'Segoe UI', -apple-system, Helvetica, Arial, sans-serif")

  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.title ?? 'Document')}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${font};
    font-size: ${options.fontSize ?? 15}px;
    line-height: 1.75;
    color: #14161c;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 2em; margin-top: 0; }
  h2 { font-size: 1.55em; }
  h3 { font-size: 1.25em; }
  p { margin: 0 0 0.85em; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 0.85em; padding-inline-start: 1.7em; }
  li { margin-bottom: 0.3em; }
  blockquote {
    margin: 1em 0; padding-inline-start: 1em;
    border-inline-start: 3px solid #d6d9e0; color: #4a5160;
  }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #c8ccd4; padding: 7px 10px; text-align: start; vertical-align: top; }
  th { background: #f2f3f7; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #d6d9e0; margin: 1.4em 0; }
  a { color: #0a60c8; }
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
