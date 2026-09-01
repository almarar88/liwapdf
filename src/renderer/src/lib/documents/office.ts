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

  // ODF keeps pictures as real files inside the package and references them by
  // path, so the images have to be pulled out before the body is written. The
  // writer used to walk past every <img>, and a logo vanished on export without
  // a word — a silent loss, which is what makes it a bug and not a limit.
  const pictures = new Map<string, { path: string; mediaType: string; base64: string }>()
  for (const image of Array.from(container.querySelectorAll('img'))) {
    const source = image.getAttribute('src') ?? ''
    const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(source)
    if (!match || pictures.has(source)) continue
    const extension = match[1].split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
    pictures.set(source, {
      path: `Pictures/image${pictures.size + 1}.${extension || 'png'}`,
      mediaType: match[1],
      base64: match[2]
    })
  }

  const body = Array.from(container.childNodes)
    .map((node) => odtBlockFrom(node, rightToLeft, pictures))
    .filter(Boolean)
    .join('')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
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
${Array.from(pictures.values())
  .map(
    (picture) =>
      ` <manifest:file-entry manifest:full-path="${picture.path}" manifest:media-type="${picture.mediaType}"/>`
  )
  .join('\n')}
</manifest:manifest>`

  const zip = new JSZip()
  // The mimetype entry must be first and stored uncompressed for ODF readers.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('content.xml', content)
  zip.file('styles.xml', styles)
  zip.file('META-INF/manifest.xml', manifest)
  for (const picture of pictures.values()) {
    zip.file(picture.path, picture.base64, { base64: true })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
}

type OdtPictures = Map<string, { path: string; mediaType: string; base64: string }>

function odtBlockFrom(node: Node, rightToLeft: boolean, pictures?: OdtPictures): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim()
    return text ? `<text:p>${escapeXml(text)}</text:p>` : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  const tag = element.tagName

  if (tag === 'HR') return '<text:p/>'
  if (tag === 'IMG') {
    const frame = odtFrameFor(element as HTMLImageElement, pictures)
    return frame ? `<text:p>${frame}</text:p>` : ''
  }
  if (/^H[1-6]$/.test(tag)) {
    return `<text:h text:outline-level="${tag[1]}">${odtInlineFrom(element, pictures)}</text:h>`
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(element.children)
      .filter((child) => child.tagName === 'LI')
      .map((item) => `<text:list-item><text:p>${odtInlineFrom(item as HTMLElement, pictures)}</text:p></text:list-item>`)
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
                cell as HTMLElement,
                pictures
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
  return `<text:p>${odtInlineFrom(element, pictures) || ''}</text:p>`
}

/**
 * A picture placed in the text flow.
 *
 * ODF sizes a frame in real units, so the pixel width the editor carries is
 * converted rather than passed through: a frame with no size, or one sized in
 * pixels, comes out at whatever the reader guesses.
 */
function odtFrameFor(image: HTMLImageElement, pictures?: OdtPictures): string {
  const picture = pictures?.get(image.getAttribute('src') ?? '')
  if (!picture) return ''
  const pixelWidth = Number(image.getAttribute('width')) || image.naturalWidth || 240
  const pixelHeight =
    Number(image.getAttribute('height')) ||
    image.naturalHeight ||
    Math.round(pixelWidth * 0.62)
  const width = (pixelWidth / 96).toFixed(3)
  const height = (pixelHeight / 96).toFixed(3)
  return (
    `<draw:frame text:anchor-type="as-char" svg:width="${width}in" svg:height="${height}in">` +
    `<draw:image xlink:href="${picture.path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
    `</draw:frame>`
  )
}

function odtInlineFrom(element: HTMLElement, pictures?: OdtPictures): string {
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
    if (tag === 'IMG') {
      output += odtFrameFor(child as HTMLImageElement, pictures)
      continue
    }
    if (tag === 'B' || tag === 'STRONG') {
      output += `<text:span text:style-name="Bold">${odtInlineFrom(child, pictures)}</text:span>`
      continue
    }
    if (tag === 'I' || tag === 'EM') {
      output += `<text:span text:style-name="Italic">${odtInlineFrom(child, pictures)}</text:span>`
      continue
    }
    if (tag === 'A') {
      const href = child.getAttribute('href') ?? ''
      output += `<text:a xlink:href="${escapeXml(href)}">${odtInlineFrom(child, pictures)}</text:a>`
      continue
    }
    output += odtInlineFrom(child, pictures)
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

  // Each slide names its pictures through its own relationship file, so the
  // map is keyed by slide as well as id: two slides reuse the same r:id for
  // different images, and a flat map would show the wrong one.
  const relationships = new Map<string, string>()
  for (const slide of slideFiles) {
    const rels = zip.file(`ppt/slides/_rels/slide${slide.index}.xml.rels`)
    if (!rels) continue
    const relsXml = parser.parseFromString(await rels.async('string'), 'application/xml')
    for (const relationship of Array.from(relsXml.getElementsByTagNameNS('*', 'Relationship'))) {
      const id = relationship.getAttribute('Id')
      const targetPath = relationship.getAttribute('Target')
      if (!id || !targetPath || !/image/i.test(relationship.getAttribute('Type') ?? '')) continue
      relationships.set(`${slide.index}:${id}`, resolveZipPath('ppt/slides/', targetPath))
    }
  }

  let imageBudget = 24 * 1024 * 1024
  const inlinedImages = new Map<string, string>()
  let droppedImages = 0

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

    // Notes are matched through the slide's relationship file, not by index:
    // slideN.xml is not required to pair with notesSlideN.xml, and after a
    // slide is deleted in PowerPoint the numbering diverges — which silently
    // attached the wrong speaker notes to the wrong slide.
    const notesPath = await notesPathFor(zip, parser, slide.index)
    const notesFile = notesPath
      ? zip.file(notesPath)
      : zip.file(`ppt/notesSlides/notesSlide${slide.index}.xml`)
    let notes = ''
    if (notesFile) {
      const notesXml = parser.parseFromString(await notesFile.async('string'), 'application/xml')
      notes = Array.from(notesXml.getElementsByTagNameNS('*', 't'))
        .map((run) => run.textContent ?? '')
        .join(' ')
        .trim()
    }

    // A deck is pictures as much as words — a slide read as text alone loses
    // the chart, the diagram and the logo that carried its point.
    const images: string[] = []
    for (const embed of Array.from(xml.getElementsByTagNameNS('*', 'blip'))) {
      const id = embed.getAttribute('r:embed') ?? embed.getAttributeNS('*', 'embed')
      if (!id) continue
      const target = relationships.get(`${slide.index}:${id}`)
      if (!target) continue
      let dataUrl = inlinedImages.get(target)
      if (dataUrl === undefined) {
        const entry = zip.file(target)
        if (!entry) continue
        const base64 = await entry.async('base64')
        const cost = Math.ceil((base64.length * 3) / 4)
        if (cost > imageBudget) {
          droppedImages += 1
          continue
        }
        imageBudget -= cost
        dataUrl = `data:${mimeFromName(target)};base64,${base64}`
        inlinedImages.set(target, dataUrl)
      }
      images.push(`<p><img src="${dataUrl}" alt="" /></p>`)
    }

    // The first line of a slide is almost always its title.
    const [title, ...rest] = paragraphs
    sections.push(
      `<h2>${escapeHtml(title ?? `Slide ${slide.index}`)}</h2>` +
        rest.map((line) => `<p>${escapeHtml(line)}</p>`).join('') +
        images.join('') +
        (notes ? `<blockquote>${escapeHtml(notes)}</blockquote>` : '') +
        (slide.index < slideFiles.length ? '<hr />' : '')
    )
  }

  const warnings = ['pptx-layout-only']
  if (droppedImages > 0) warnings.push('pptx-images-dropped')
  return { html: sections.join('\n'), warnings }
}

/** Follows slideN.xml.rels to whichever notesSlide it actually points at. */
async function notesPathFor(
  zip: JSZip,
  parser: DOMParser,
  index: number
): Promise<string | null> {
  const relationships = zip.file(`ppt/slides/_rels/slide${index}.xml.rels`)
  if (!relationships) return null
  try {
    const xml = parser.parseFromString(await relationships.async('string'), 'application/xml')
    for (const entry of Array.from(xml.getElementsByTagNameNS('*', 'Relationship'))) {
      const type = entry.getAttribute('Type') ?? ''
      if (!type.endsWith('/notesSlide')) continue
      const target = entry.getAttribute('Target')
      if (!target) continue
      return resolveZipPath('ppt/slides/', target)
    }
  } catch {
    return null
  }
  return null
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
  // Illustrations are half of what a book is, and a relative `src` inside a
  // zip resolves to nothing once the chapter is lifted out of it — so each
  // referenced image is inlined as a data URL, up to a budget that keeps a
  // heavily illustrated book from exhausting memory.
  let imageBudget = 24 * 1024 * 1024
  const inlined = new Map<string, string>()
  let droppedImages = 0

  for (const path of spine.slice(0, 200)) {
    const file = zip.file(path)
    if (!file) continue
    const raw = await file.async('string')
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw)
    if (!bodyMatch) continue

    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    let body = bodyMatch[1]

    for (const reference of collectImageSources(body)) {
      if (/^(data|https?):/i.test(reference)) continue
      const resolved = resolveZipPath(directory, reference)
      let dataUrl = inlined.get(resolved)
      if (dataUrl === undefined) {
        const entry = zip.file(resolved)
        if (!entry) continue
        const data = await entry.async('base64')
        const cost = Math.ceil((data.length * 3) / 4)
        if (cost > imageBudget) {
          droppedImages += 1
          continue
        }
        imageBudget -= cost
        dataUrl = `data:${mimeFromName(resolved)};base64,${data}`
        inlined.set(resolved, dataUrl)
      }
      body = body.split(reference).join(dataUrl)
    }

    chapters.push(body)
  }

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim()
  const warnings: string[] = []
  if (chapters.length === 0) warnings.push('epub-empty')
  if (droppedImages > 0) warnings.push('epub-images-dropped')
  return {
    html: (title ? `<h1>${escapeHtml(title)}</h1>` : '') + chapters.join('\n<hr />\n'),
    warnings
  }
}

/** Every `src`/`xlink:href` an EPUB chapter points an image at. */
function collectImageSources(html: string): string[] {
  const found = new Set<string>()
  const pattern = /<(?:img|image)\b[^>]*?(?:xlink:href|href|src)\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) found.add(match[1])
  }
  return [...found]
}

/** Resolves an EPUB-relative href against its chapter's folder. */
function resolveZipPath(directory: string, reference: string): string {
  const target = reference.split(/[?#]/)[0]
  if (target.startsWith('/')) return target.slice(1)
  const parts = (directory + target).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
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
