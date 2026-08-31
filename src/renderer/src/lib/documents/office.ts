import JSZip from 'jszip'
import { escapeHtml } from '../format'
import { decodeText } from '../text/encoding'

/**
 * Readers for the ZIP-packaged office formats (ODT, PPTX, EPUB) plus a
 * best-effort extractor for the legacy binary .doc container.
 */

export interface OfficeReadResult {
  html: string
  warnings: string[]
}

/* -------------------------------------------------------------------- ODT */

export async function odtToHtml(bytes: Uint8Array): Promise<OfficeReadResult> {
  const zip = await JSZip.loadAsync(bytes)
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error('odt-missing-content')

  const xml = new DOMParser().parseFromString(await contentFile.async('string'), 'application/xml')
  const styles = collectOdtStyles(xml)

  const body = xml.getElementsByTagNameNS('*', 'text')[0]
  if (!body) return { html: '<p></p>', warnings: ['odt-empty'] }

  const images = await collectOdtImages(zip)
  const html = Array.from(body.childNodes)
    .map((node) => renderOdtBlock(node, styles, images))
    .filter(Boolean)
    .join('\n')

  return { html: html || '<p></p>', warnings: [] }
}

interface OdtStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  size?: string
  align?: string
  rtl?: boolean
}

function collectOdtStyles(xml: Document): Map<string, OdtStyle> {
  const styles = new Map<string, OdtStyle>()
  const nodes = xml.getElementsByTagNameNS('*', 'style')

  for (const node of Array.from(nodes)) {
    const name = node.getAttributeNS('*', 'name') ?? node.getAttribute('style:name')
    if (!name) continue
    const style: OdtStyle = {}

    const text = node.getElementsByTagNameNS('*', 'text-properties')[0]
    if (text) {
      const weight = attribute(text, 'font-weight')
      const posture = attribute(text, 'font-style')
      const underline = attribute(text, 'text-underline-style')
      const strike = attribute(text, 'text-line-through-style')
      if (weight && weight !== 'normal') style.bold = true
      if (posture === 'italic' || posture === 'oblique') style.italic = true
      if (underline && underline !== 'none') style.underline = true
      if (strike && strike !== 'none') style.strike = true
      const color = attribute(text, 'color')
      if (color && color !== '#000000') style.color = color
      const size = attribute(text, 'font-size')
      if (size) style.size = size
    }

    const paragraph = node.getElementsByTagNameNS('*', 'paragraph-properties')[0]
    if (paragraph) {
      const align = attribute(paragraph, 'text-align')
      if (align) style.align = align === 'end' ? 'end' : align === 'center' ? 'center' : align === 'justify' ? 'justify' : 'start'
      if (attribute(paragraph, 'writing-mode')?.startsWith('rl')) style.rtl = true
    }

    styles.set(name, style)
  }
  return styles
}

function attribute(element: Element, localName: string): string | null {
  for (const attr of Array.from(element.attributes)) {
    if (attr.localName === localName) return attr.value
  }
  return null
}

async function collectOdtImages(zip: JSZip): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  const entries = zip.folder('Pictures')
  if (!entries) return images

  const files: JSZip.JSZipObject[] = []
  entries.forEach((_path, file) => {
    if (!file.dir) files.push(file)
  })

  for (const file of files.slice(0, 60)) {
    try {
      const base64 = await file.async('base64')
      images.set(file.name, `data:${mimeFromName(file.name)};base64,${base64}`)
    } catch {
      /* a single unreadable picture should not fail the document */
    }
  }
  return images
}

function renderOdtBlock(node: Node, styles: Map<string, OdtStyle>, images: Map<string, string>): string {
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as Element
  const local = element.localName

  if (local === 'h') {
    const level = Math.min(6, Math.max(1, Number(attribute(element, 'outline-level') ?? '1')))
    const style = styles.get(attribute(element, 'style-name') ?? '')
    return `<h${level}${blockAttributes(style)}>${renderOdtInline(element, styles, images)}</h${level}>`
  }
  if (local === 'p') {
    const style = styles.get(attribute(element, 'style-name') ?? '')
    const inner = renderOdtInline(element, styles, images)
    return `<p${blockAttributes(style)}>${inner || '<br />'}</p>`
  }
  if (local === 'list') {
    const items = Array.from(element.children)
      .filter((child) => child.localName === 'list-item')
      .map(
        (item) =>
          `<li>${Array.from(item.children)
            .map((child) => renderOdtBlock(child, styles, images))
            .join('')
            .replace(/^<p[^>]*>|<\/p>$/g, '')}</li>`
      )
      .join('')
    return `<ul>${items}</ul>`
  }
  if (local === 'table') {
    const rows = Array.from(element.getElementsByTagNameNS('*', 'table-row'))
      .map((row) => {
        const cells = Array.from(row.children)
          .filter((cell) => cell.localName === 'table-cell')
          .map(
            (cell) =>
              `<td>${Array.from(cell.children)
                .map((child) => renderOdtBlock(child, styles, images))
                .join('')}</td>`
          )
          .join('')
        return `<tr>${cells}</tr>`
      })
      .join('')
    return `<table>${rows}</table>`
  }
  if (local === 'section') {
    return Array.from(element.childNodes)
      .map((child) => renderOdtBlock(child, styles, images))
      .join('')
  }
  return ''
}

function blockAttributes(style: OdtStyle | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  if (style.align && style.align !== 'start') parts.push(`text-align:${style.align}`)
  const dir = style.rtl ? ' dir="rtl"' : ''
  return `${dir}${parts.length > 0 ? ` style="${parts.join(';')}"` : ''}`
}

function renderOdtInline(element: Element, styles: Map<string, OdtStyle>, images: Map<string, string>): string {
  let html = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      html += escapeHtml(node.textContent ?? '')
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    const local = child.localName

    if (local === 's') {
      html += '&nbsp;'.repeat(Number(attribute(child, 'c') ?? '1'))
      continue
    }
    if (local === 'tab') {
      html += '&emsp;'
      continue
    }
    if (local === 'line-break') {
      html += '<br />'
      continue
    }
    if (local === 'image') {
      const href = attribute(child, 'href')?.replace(/^\.\//, '')
      const source = href ? images.get(href) : undefined
      if (source) html += `<img src="${source}" alt="" />`
      continue
    }
    if (local === 'a') {
      const href = attribute(child, 'href') ?? ''
      html += `<a href="${escapeHtml(href)}">${renderOdtInline(child, styles, images)}</a>`
      continue
    }
    if (local === 'span') {
      const style = styles.get(attribute(child, 'style-name') ?? '')
      html += wrapInline(renderOdtInline(child, styles, images), style)
      continue
    }
    html += renderOdtInline(child, styles, images)
  }
  return html
}

function wrapInline(inner: string, style: OdtStyle | undefined): string {
  if (!style || !inner) return inner
  let html = inner
  const inlineStyles: string[] = []
  if (style.color) inlineStyles.push(`color:${style.color}`)
  if (style.size) inlineStyles.push(`font-size:${style.size}`)
  if (inlineStyles.length > 0) html = `<span style="${inlineStyles.join(';')}">${html}</span>`
  if (style.strike) html = `<s>${html}</s>`
  if (style.underline) html = `<u>${html}</u>`
  if (style.italic) html = `<em>${html}</em>`
  if (style.bold) html = `<strong>${html}</strong>`
  return html
}

/* ------------------------------------------------------------- ODT writer */

export async function htmlToOdt(html: string, rightToLeft: boolean): Promise<Uint8Array> {
  const container = document.createElement('div')
  container.innerHTML = html

  const body = Array.from(container.childNodes)
    .map((node) => odtBlockFrom(node, rightToLeft))
    .filter(Boolean)
    .join('')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
 <office:automatic-styles>
  <style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
 </office:automatic-styles>
 <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
 <office:styles>
  <style:default-style style:family="paragraph">
   <style:paragraph-properties${rightToLeft ? ' style:writing-mode="rl-tb"' : ''}/>
   <style:text-properties style:font-name="${rightToLeft ? 'Arial' : 'Calibri'}" fo:font-size="11pt"/>
  </style:default-style>
 </office:styles>
</office:document-styles>`

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`

  const zip = new JSZip()
  // The mimetype entry must be first and stored uncompressed for ODF readers.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('content.xml', content)
  zip.file('styles.xml', styles)
  zip.file('META-INF/manifest.xml', manifest)

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
}

function odtBlockFrom(node: Node, rightToLeft: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim()
    return text ? `<text:p>${escapeXml(text)}</text:p>` : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  const tag = element.tagName

  if (tag === 'HR') return '<text:p/>'
  if (/^H[1-6]$/.test(tag)) {
    return `<text:h text:outline-level="${tag[1]}">${odtInlineFrom(element)}</text:h>`
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(element.children)
      .filter((child) => child.tagName === 'LI')
      .map((item) => `<text:list-item><text:p>${odtInlineFrom(item as HTMLElement)}</text:p></text:list-item>`)
      .join('')
    return `<text:list>${items}</text:list>`
  }
  if (tag === 'TABLE') {
    const rows = Array.from(element.querySelectorAll('tr'))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map(
            (cell) =>
              `<table:table-cell office:value-type="string"><text:p>${odtInlineFrom(
                cell as HTMLElement
              )}</text:p></table:table-cell>`
          )
          .join('')
        return `<table:table-row>${cells}</table:table-row>`
      })
      .join('')
    return `<table:table table:name="Table">${rows}</table:table>`
  }
  if (['DIV', 'SECTION', 'ARTICLE', 'MAIN'].includes(tag)) {
    return Array.from(element.childNodes)
      .map((child) => odtBlockFrom(child, rightToLeft))
      .join('')
  }
  return `<text:p>${odtInlineFrom(element) || ''}</text:p>`
}

function odtInlineFrom(element: HTMLElement): string {
  let output = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      output += escapeXml(node.textContent ?? '')
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as HTMLElement
    const tag = child.tagName
    if (tag === 'BR') {
      output += '<text:line-break/>'
      continue
    }
    if (tag === 'B' || tag === 'STRONG') {
      output += `<text:span text:style-name="Bold">${odtInlineFrom(child)}</text:span>`
      continue
    }
    if (tag === 'I' || tag === 'EM') {
      output += `<text:span text:style-name="Italic">${odtInlineFrom(child)}</text:span>`
      continue
    }
    if (tag === 'A') {
      const href = child.getAttribute('href') ?? ''
      output += `<text:a xlink:href="${escapeXml(href)}">${odtInlineFrom(child)}</text:a>`
      continue
    }
    output += odtInlineFrom(child)
  }
  return output
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/* ------------------------------------------------------------------- PPTX */

export async function pptxToHtml(bytes: Uint8Array): Promise<OfficeReadResult> {
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles: { index: number; file: JSZip.JSZipObject }[] = []

  zip.forEach((path, file) => {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)
    if (match) slideFiles.push({ index: Number(match[1]), file })
  })
  if (slideFiles.length === 0) throw new Error('pptx-no-slides')
  slideFiles.sort((a, b) => a.index - b.index)

  const parser = new DOMParser()
  const sections: string[] = []

  for (const slide of slideFiles) {
    const xml = parser.parseFromString(await slide.file.async('string'), 'application/xml')
    const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p'))
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS('*', 't'))
          .map((run) => run.textContent ?? '')
          .join('')
          .trim()
      )
      .filter((line) => line.length > 0)

    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slide.index}.xml`)
    let notes = ''
    if (notesFile) {
      const notesXml = parser.parseFromString(await notesFile.async('string'), 'application/xml')
      notes = Array.from(notesXml.getElementsByTagNameNS('*', 't'))
        .map((run) => run.textContent ?? '')
        .join(' ')
        .trim()
    }

    // The first line of a slide is almost always its title.
    const [title, ...rest] = paragraphs
    sections.push(
      `<h2>${escapeHtml(title ?? `Slide ${slide.index}`)}</h2>` +
        rest.map((line) => `<p>${escapeHtml(line)}</p>`).join('') +
        (notes ? `<blockquote>${escapeHtml(notes)}</blockquote>` : '') +
        (slide.index < slideFiles.length ? '<hr />' : '')
    )
  }

  return { html: sections.join('\n'), warnings: ['pptx-text-only'] }
}

/* ------------------------------------------------------------------- EPUB */

export async function epubToHtml(bytes: Uint8Array): Promise<OfficeReadResult> {
  const zip = await JSZip.loadAsync(bytes)
  const parser = new DOMParser()

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('epub-missing-container')
  const container = parser.parseFromString(await containerFile.async('string'), 'application/xml')
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('epub-missing-opf')

  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('epub-missing-opf')
  const opf = parser.parseFromString(await opfFile.async('string'), 'application/xml')
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const manifest = new Map<string, string>()
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) manifest.set(id, base + href)
  }

  const spine = Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
    .map((reference) => manifest.get(reference.getAttribute('idref') ?? ''))
    .filter((path): path is string => Boolean(path))

  const chapters: string[] = []
  for (const path of spine.slice(0, 200)) {
    const file = zip.file(path)
    if (!file) continue
    const raw = await file.async('string')
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw)
    if (bodyMatch) chapters.push(bodyMatch[1])
  }

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim()
  return {
    html: (title ? `<h1>${escapeHtml(title)}</h1>` : '') + chapters.join('\n<hr />\n'),
    warnings: chapters.length === 0 ? ['epub-empty'] : []
  }
}

/* -------------------------------------------------------- legacy .doc */

/**
 * Word 97 .doc is an OLE2 compound file with the text split across a piece
 * table. Rather than implement the full format, this pulls out the readable
 * runs — both CP1252 and UTF-16LE — and stitches them into paragraphs. It is
 * explicitly best-effort, and the caller surfaces that to the user.
 */
export function legacyDocToHtml(bytes: Uint8Array): OfficeReadResult {
  const utf16 = extractUtf16Runs(bytes)
  const singleByte = extractSingleByteRuns(bytes)
  const chosen = utf16.join('').length >= singleByte.join('').length ? utf16 : singleByte

  const paragraphs = chosen
    .join('\n')
    // Word uses vertical tab and form feed as line and page separators.
    .split(/[\r\n\v\f\u2028\u2029]+/)
    .map((line) => line.replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').trim())
    .filter((line) => line.length > 1)

  if (paragraphs.length === 0) throw new Error('doc-no-text')

  return {
    html: paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
    warnings: ['doc-text-only']
  }
}

function extractUtf16Runs(bytes: Uint8Array): string[] {
  const runs: string[] = []
  let current = ''
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8)
    if (isReadableCode(code)) {
      current += String.fromCharCode(code)
    } else {
      if (current.length >= 8) runs.push(current)
      current = ''
    }
  }
  if (current.length >= 8) runs.push(current)
  return runs
}

function extractSingleByteRuns(bytes: Uint8Array): string[] {
  const runs: string[] = []
  let start = -1
  for (let index = 0; index <= bytes.length; index += 1) {
    const byte = index < bytes.length ? bytes[index] : 0
    const readable = byte === 0x0d || byte === 0x0a || byte === 0x09 || (byte >= 0x20 && byte !== 0x7f)
    if (readable && start === -1) start = index
    else if (!readable && start !== -1) {
      if (index - start >= 8) {
        runs.push(decodeText(bytes.subarray(start, index)).text)
      }
      start = -1
    }
  }
  return runs
}

function isReadableCode(code: number): boolean {
  if (code === 0x0d || code === 0x0a || code === 0x09) return true
  if (code < 0x20) return false
  if (code === 0x7f) return false
  if (code >= 0xd800 && code <= 0xdfff) return false
  if (code >= 0xf000 && code <= 0xf0ff) return false // private-use symbol fonts
  return code <= 0xfffd
}

export function mimeFromName(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? ''
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    avif: 'image/avif'
  }
  return table[extension] ?? 'application/octet-stream'
}
