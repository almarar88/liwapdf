import JSZip from 'jszip'

/**
 * Reads a .docx the way Word laid it out, not the way a semantic converter
 * summarises it.
 *
 * mammoth turns a document into clean HTML and drops everything Word users
 * actually chose: the font (Sakkal Majalla, Traditional Arabic…), the size,
 * the colour, the alignment, the paragraph direction. A letter in 16pt
 * right-aligned Arabic came into the editor as left-aligned default text.
 * This reader walks the OOXML itself and carries those properties across as
 * inline styles, resolving them through the style hierarchy the same way
 * Word does: document defaults, then the paragraph style chain, then the
 * paragraph's own run properties, then the run.
 */

export interface OoxmlResult {
  html: string
  direction: 'rtl' | 'ltr'
  warnings: string[]
  /** The page Word laid the document out on, so a PDF can use the same one. */
  page: PageSetup
}

export interface PageSetup {
  /** Page box in points. */
  width: number
  height: number
  landscape: boolean
  margins: { top: number; right: number; bottom: number; left: number }
}

const DEFAULT_PAGE: PageSetup = {
  width: 595.3,
  height: 841.9,
  landscape: false,
  margins: { top: 72, right: 72, bottom: 72, left: 72 }
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

interface RunProps {
  font?: string
  fontCs?: string
  size?: number
  sizeCs?: number
  bold?: boolean
  boldCs?: boolean
  italic?: boolean
  italicCs?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: string
  shade?: string
  vertAlign?: 'superscript' | 'subscript'
  rtl?: boolean
}

interface ParaProps {
  align?: string
  bidi?: boolean
  indentLeft?: number
  indentRight?: number
  firstLine?: number
  hanging?: number
  before?: number
  after?: number
  line?: number
  lineRule?: string
  numId?: string
  level?: number
  styleId?: string
  runProps?: RunProps
}

interface Style {
  id: string
  name: string
  type: string
  basedOn?: string
  paragraph: ParaProps
  run: RunProps
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000'
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf'
}

export async function docxToRichHtml(bytes: Uint8Array): Promise<OoxmlResult> {
  const zip = await JSZip.loadAsync(bytes)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('docx-missing-document')
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
  const numberingXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(documentXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('docx-bad-xml')

  const warnings: string[] = []
  const reader = new Reader(parser, stylesXml, numberingXml, relsXml, zip, warnings)
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  if (!body) throw new Error('docx-missing-body')

  const html = await reader.renderBlocks(Array.from(body.children))
  const sectPr = child(body, 'sectPr')
  const page = readPageSetup(sectPr)
  // The section's own bidi flag is Word's answer; without it, whichever
  // script carries more of the document's text decides.
  const sectionBidi = sectPr ? child(sectPr, 'bidi') : null
  const flagged = sectionBidi ? flag(sectionBidi) : undefined
  const direction: 'rtl' | 'ltr' = flagged ?? reader.rtlChars > reader.ltrChars ? 'rtl' : 'ltr'
  return { html: html || '<p></p>', direction, warnings, page }
}

/**
 * The page the document was written for. Word stores it in twentieths of a
 * point; a PDF made from the document should use the same paper and the same
 * margins, not whatever the exporter defaults to.
 */
function readPageSetup(sectPr: Element | null): PageSetup {
  if (!sectPr) return DEFAULT_PAGE
  const size = child(sectPr, 'pgSz')
  const margin = child(sectPr, 'pgMar')
  const attribute = (element: Element | null, name: string): number | undefined => {
    if (!element) return undefined
    const value = element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`)
    const number = value === null ? Number.NaN : Number(value)
    return Number.isFinite(number) ? number / 20 : undefined
  }
  const width = attribute(size, 'w') ?? DEFAULT_PAGE.width
  const height = attribute(size, 'h') ?? DEFAULT_PAGE.height
  const orientation = size?.getAttributeNS(W, 'orient') ?? size?.getAttribute('w:orient')
  // Word marks landscape and also swaps the stored width and height; trust
  // whichever is larger rather than the flag alone.
  const landscape = orientation === 'landscape' || width > height
  return {
    width,
    height,
    landscape,
    margins: {
      top: attribute(margin, 'top') ?? DEFAULT_PAGE.margins.top,
      right: attribute(margin, 'right') ?? DEFAULT_PAGE.margins.right,
      bottom: attribute(margin, 'bottom') ?? DEFAULT_PAGE.margins.bottom,
      left: attribute(margin, 'left') ?? DEFAULT_PAGE.margins.left
    }
  }
}

class Reader {
  private styles = new Map<string, Style>()
  private defaultRun: RunProps = {}
  private defaultParagraph: ParaProps = {}
  private rels = new Map<string, { target: string; mode?: string }>()
  private numbering = new Map<string, Map<number, string>>()
  private abstractOf = new Map<string, string>()
  private images = new Map<string, string>()
  rtlChars = 0
  ltrChars = 0

  constructor(
    parser: DOMParser,
    stylesXml: string,
    numberingXml: string,
    relsXml: string,
    private zip: JSZip,
    private warnings: string[]
  ) {
    if (stylesXml) this.readStyles(parser.parseFromString(stylesXml, 'application/xml'))
    if (numberingXml) this.readNumbering(parser.parseFromString(numberingXml, 'application/xml'))
    if (relsXml) {
      const rels = parser.parseFromString(relsXml, 'application/xml')
      for (const rel of Array.from(rels.getElementsByTagNameNS(REL, 'Relationship'))) {
        const id = rel.getAttribute('Id')
        const target = rel.getAttribute('Target')
        if (id && target) this.rels.set(id, { target, mode: rel.getAttribute('TargetMode') ?? undefined })
      }
    }
  }

  private readStyles(styles: Document): void {
    const defaults = styles.getElementsByTagNameNS(W, 'docDefaults')[0]
    if (defaults) {
      const rPr = defaults.getElementsByTagNameNS(W, 'rPr')[0]
      const pPr = defaults.getElementsByTagNameNS(W, 'pPr')[0]
      if (rPr) this.defaultRun = readRunProps(rPr)
      if (pPr) this.defaultParagraph = readParaProps(pPr)
    }
    for (const element of Array.from(styles.getElementsByTagNameNS(W, 'style'))) {
      const id = element.getAttributeNS(W, 'styleId') ?? element.getAttribute('w:styleId') ?? ''
      if (!id) continue
      const name = child(element, 'name')?.getAttributeNS(W, 'val') ?? child(element, 'name')?.getAttribute('w:val') ?? id
      const basedOn = val(child(element, 'basedOn'))
      const pPr = child(element, 'pPr')
      const rPr = child(element, 'rPr')
      this.styles.set(id, {
        id,
        name,
        type: element.getAttributeNS(W, 'type') ?? element.getAttribute('w:type') ?? 'paragraph',
        basedOn: basedOn ?? undefined,
        paragraph: pPr ? readParaProps(pPr) : {},
        run: rPr ? readRunProps(rPr) : {}
      })
    }
  }

  private readNumbering(numbering: Document): void {
    for (const abstract of Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum'))) {
      const id = abstract.getAttributeNS(W, 'abstractNumId') ?? abstract.getAttribute('w:abstractNumId') ?? ''
      const levels = new Map<number, string>()
      for (const level of Array.from(abstract.getElementsByTagNameNS(W, 'lvl'))) {
        const index = Number(level.getAttributeNS(W, 'ilvl') ?? level.getAttribute('w:ilvl') ?? 0)
        levels.set(index, val(child(level, 'numFmt')) ?? 'decimal')
      }
      this.numbering.set(id, levels)
    }
    for (const num of Array.from(numbering.getElementsByTagNameNS(W, 'num'))) {
      const id = num.getAttributeNS(W, 'numId') ?? num.getAttribute('w:numId') ?? ''
      const abstract = val(child(num, 'abstractNumId'))
      if (id && abstract) this.abstractOf.set(id, abstract)
    }
  }

  /** Style chain for a paragraph style, outermost first. */
  private chain(styleId: string | undefined): Style[] {
    const out: Style[] = []
    let id = styleId
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const style = this.styles.get(id)
      if (!style) break
      out.unshift(style)
      id = style.basedOn
    }
    return out
  }

  private resolveParagraph(own: ParaProps): { paragraph: ParaProps; run: RunProps; styleName: string } {
    const styleId = own.styleId ?? this.defaultParagraphStyle()
    const chain = this.chain(styleId)
    let paragraph: ParaProps = { ...this.defaultParagraph }
    let run: RunProps = { ...this.defaultRun }
    for (const style of chain) {
      paragraph = { ...paragraph, ...style.paragraph }
      run = { ...run, ...style.run }
    }
    paragraph = { ...paragraph, ...own }
    return { paragraph, run, styleName: chain[chain.length - 1]?.name ?? '' }
  }

  private defaultParagraphStyle(): string | undefined {
    for (const style of this.styles.values()) if (style.type === 'paragraph' && style.name.toLowerCase() === 'normal') return style.id
    return undefined
  }

  private resolveRun(base: RunProps, own: RunProps, styleId?: string): RunProps {
    let run = { ...base }
    if (styleId) {
      const style = this.styles.get(styleId)
      if (style) run = { ...run, ...style.run }
    }
    return { ...run, ...own }
  }

  async renderBlocks(nodes: Element[]): Promise<string> {
    const out: string[] = []
    let list: { numId: string; level: number; ordered: boolean; items: string[] } | null = null
    const closeList = (): void => {
      if (!list) return
      const tag = list.ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`)
      list = null
    }
    for (const node of nodes) {
      if (node.namespaceURI !== W) continue
      if (node.localName === 'p') {
        const own = readParaProps(child(node, 'pPr'))
        const rendered = await this.renderParagraph(node, own)
        if (own.numId && own.numId !== '0') {
          const format = this.numbering.get(this.abstractOf.get(own.numId) ?? '')?.get(own.level ?? 0) ?? 'decimal'
          const ordered = format !== 'bullet'
          if (!list || list.numId !== own.numId) {
            closeList()
            list = { numId: own.numId, level: own.level ?? 0, ordered, items: [] }
          }
          list.items.push(rendered.inner)
        } else {
          closeList()
          out.push(rendered.html)
        }
      } else if (node.localName === 'tbl') {
        closeList()
        out.push(await this.renderTable(node))
      } else if (node.localName === 'sdt') {
        const content = child(node, 'sdtContent')
        if (content) out.push(await this.renderBlocks(Array.from(content.children)))
      }
    }
    closeList()
    return out.join('\n')
  }

  private async renderParagraph(node: Element, own: ParaProps): Promise<{ html: string; inner: string }> {
    const { paragraph, run: baseRun, styleName } = this.resolveParagraph(own)
    const runs = await this.renderInline(node, { ...baseRun, ...(own.runProps ?? {}) })
    const text = runs.text
    const rtl = paragraph.bidi ?? isRtlText(text)
    const letters = text.replace(/[^\p{L}]/gu, '').length
    if (rtl) this.rtlChars += letters
    else this.ltrChars += letters
    const styles: string[] = []
    const align = cssAlign(paragraph.align, rtl)
    if (align) styles.push(`text-align:${align}`)
    if (paragraph.indentLeft) styles.push(`margin-left:${twipsToPt(paragraph.indentLeft)}pt`)
    if (paragraph.indentRight) styles.push(`margin-right:${twipsToPt(paragraph.indentRight)}pt`)
    if (paragraph.firstLine) styles.push(`text-indent:${twipsToPt(paragraph.firstLine)}pt`)
    else if (paragraph.hanging) styles.push(`text-indent:-${twipsToPt(paragraph.hanging)}pt;padding-inline-start:${twipsToPt(paragraph.hanging)}pt`)
    if (paragraph.before !== undefined) styles.push(`margin-top:${twipsToPt(paragraph.before)}pt`)
    if (paragraph.after !== undefined) styles.push(`margin-bottom:${twipsToPt(paragraph.after)}pt`)
    if (paragraph.line && paragraph.lineRule !== 'exact' && paragraph.lineRule !== 'atLeast') {
      const ratio = Math.round((paragraph.line / 240) * 100) / 100
      if (ratio > 0 && ratio !== 1) styles.push(`line-height:${ratio}`)
    }
    const tag = headingTag(styleName)
    const attrs = `${rtl ? ' dir="rtl"' : ' dir="ltr"'}${styles.length > 0 ? ` style="${styles.join(';')}"` : ''}`
    const inner = runs.html || '<br>'
    return { html: `<${tag}${attrs}>${inner}</${tag}>`, inner }
  }

  private async renderInline(node: Element, base: RunProps): Promise<{ html: string; text: string }> {
    let html = ''
    let text = ''
    for (const element of Array.from(node.children)) {
      if (element.namespaceURI !== W) continue
      if (element.localName === 'r') {
        const rendered = await this.renderRun(element, base)
        html += rendered.html
        text += rendered.text
      } else if (element.localName === 'hyperlink') {
        const id = element.getAttributeNS(R, 'id') ?? element.getAttribute('r:id')
        const rel = id ? this.rels.get(id) : undefined
        const inner = await this.renderInline(element, base)
        const href = rel && rel.mode === 'External' ? rel.target : element.getAttributeNS(W, 'anchor') ? `#${element.getAttributeNS(W, 'anchor')}` : ''
        html += href ? `<a href="${escapeAttr(href)}">${inner.html}</a>` : inner.html
        text += inner.text
      } else if (element.localName === 'smartTag' || element.localName === 'ins' || element.localName === 'sdt' || element.localName === 'fldSimple') {
        const content = element.localName === 'sdt' ? child(element, 'sdtContent') ?? element : element
        const inner = await this.renderInline(content, base)
        html += inner.html
        text += inner.text
      }
    }
    return { html, text }
  }

  private async renderRun(run: Element, base: RunProps): Promise<{ html: string; text: string }> {
    const rPr = child(run, 'rPr')
    const own = rPr ? readRunProps(rPr) : {}
    const styleId = rPr ? val(child(rPr, 'rStyle')) : undefined
    const props = this.resolveRun(base, own, styleId ?? undefined)
    let text = ''
    let content = ''
    for (const element of Array.from(run.children)) {
      if (element.namespaceURI !== W) continue
      switch (element.localName) {
        case 't':
          text += element.textContent ?? ''
          content += escapeHtml(element.textContent ?? '')
          break
        case 'tab':
          text += '\t'
          content += '&#9;'
          break
        case 'br':
          content += '<br>'
          break
        case 'sym': {
          const charCode = element.getAttributeNS(W, 'char') ?? element.getAttribute('w:char')
          if (charCode) content += escapeHtml(String.fromCharCode(parseInt(charCode, 16)))
          break
        }
        case 'drawing':
        case 'pict': {
          const image = await this.renderImage(element)
          if (image) content += image
          break
        }
        default:
          break
      }
    }
    if (!content) return { html: '', text: '' }
    return { html: wrapRun(content, props, text), text }
  }

  private async renderImage(element: Element): Promise<string> {
    const blip = element.getElementsByTagNameNS(A, 'blip')[0]
    const id = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttribute('r:embed')
    if (!id) return ''
    const rel = this.rels.get(id)
    if (!rel) return ''
    const cached = this.images.get(id)
    if (cached) return cached
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`
    const file = this.zip.file(path)
    if (!file) {
      this.warnings.push(`image missing: ${rel.target}`)
      return ''
    }
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME[extension]
    if (!mime || mime === 'image/emf' || mime === 'image/wmf') {
      this.warnings.push(`unsupported image: ${rel.target}`)
      return ''
    }
    const base64 = await file.async('base64')
    // Size from the drawing's extent, in EMUs.
    const extent = element.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0]
    const cx = Number(extent?.getAttribute('cx') ?? 0)
    const width = cx > 0 ? ` style="width:${Math.round(cx / 12700)}pt;max-width:100%"` : ''
    const html = `<img src="data:${mime};base64,${base64}" alt=""${width}>`
    this.images.set(id, html)
    return html
  }

  private async renderTable(table: Element): Promise<string> {
    const tblPr = child(table, 'tblPr')
    // Word's own borders and widths, rather than a house style imposed on
    // every table: a borderless layout table must stay borderless.
    const outer = readBorders(tblPr ? child(tblPr, 'tblBorders') : null)
    const inside = readInsideBorders(tblPr ? child(tblPr, 'tblBorders') : null)
    const tableStyles: string[] = ['border-collapse:collapse']
    const width = tblPr ? child(tblPr, 'tblW') : null
    const widthValue = measure(width, 'w')
    const widthType = width?.getAttributeNS(W, 'type') ?? width?.getAttribute('w:type')
    const proportional = widthType === 'pct' || widthType === 'auto' || widthType === undefined
    if (widthType === 'pct' && widthValue !== undefined) {
      // Word writes fiftieths of a percent, newer files a plain percentage.
      tableStyles.push(`width:${widthValue > 100 ? widthValue / 50 : widthValue}%`)
    } else if (widthType === 'dxa' && widthValue !== undefined) {
      tableStyles.push(`width:${twipsToPt(widthValue)}pt`)
    }
    const jc = tblPr ? val(child(tblPr, 'jc')) : null
    if (jc === 'center') tableStyles.push('margin-inline:auto')
    else if (jc === 'right' || jc === 'end') tableStyles.push('margin-inline-start:auto')

    // Column widths from the grid. In a table sized as a percentage the grid
    // holds relative shares, so they become percentages too — turning them
    // into absolute points there would collapse the table to a few millimetres.
    const grid = child(table, 'tblGrid')
    const gridWidths: number[] = []
    if (grid) {
      for (const column of Array.from(grid.children)) {
        if (column.namespaceURI !== W || column.localName !== 'gridCol') continue
        gridWidths.push(measure(column, 'w') ?? 0)
      }
    }
    const gridTotal = gridWidths.reduce((sum, value) => sum + value, 0)
    const columns = gridWidths.map((value) => {
      if (value <= 0 || gridTotal <= 0) return '<col>'
      const size = proportional
        ? `${Math.round((value / gridTotal) * 10000) / 100}%`
        : `${twipsToPt(value)}pt`
      return `<col style="width:${size}">`
    })

    const bodyRows = Array.from(table.children).filter(
      (row) => row.namespaceURI === W && row.localName === 'tr'
    )
    const rows: string[] = []
    for (const [rowIndex, row] of bodyRows.entries()) {
      const trPr = child(row, 'trPr')
      const header = Boolean(trPr && child(trPr, 'tblHeader'))
      const height = trPr ? child(trPr, 'trHeight') : null
      const heightValue = measure(height, 'val')
      const rowCells = Array.from(row.children).filter(
        (cell) => cell.namespaceURI === W && cell.localName === 'tc'
      )
      const cells: string[] = []
      let column = 0
      for (const [cellIndex, cell] of rowCells.entries()) {
        const tcPr = child(cell, 'tcPr')
        const span = tcPr ? Number(val(child(tcPr, 'gridSpan')) ?? 1) || 1 : 1
        const first = cellIndex === 0
        const last = cellIndex === rowCells.length - 1
        column += span
        const merge = tcPr ? child(tcPr, 'vMerge') : null
        if (merge && !(merge.getAttributeNS(W, 'val') ?? merge.getAttribute('w:val'))) continue
        const styles: string[] = []
        const shade = tcPr ? child(tcPr, 'shd') : null
        const fill = shade?.getAttributeNS(W, 'fill') ?? shade?.getAttribute('w:fill')
        if (fill && fill !== 'auto') styles.push(`background:#${fill}`)
        // An edge of the table takes the table's own border; an edge between
        // two cells takes the inside rule.
        const edges: Record<string, string | undefined> = {
          top: rowIndex === 0 ? outer.top : inside.horizontal,
          bottom: rowIndex === bodyRows.length - 1 ? outer.bottom : inside.horizontal,
          left: first ? outer.left : inside.vertical,
          right: last ? outer.right : inside.vertical
        }
        const cellBorders = readBorders(tcPr ? child(tcPr, 'tcBorders') : null)
        for (const [side, value] of Object.entries({ ...edges, ...cellBorders })) {
          if (value) styles.push(`border-${side}:${value}`)
        }
        const align = tcPr ? val(child(tcPr, 'vAlign')) : null
        styles.push(`vertical-align:${align === 'center' ? 'middle' : align === 'bottom' ? 'bottom' : 'top'}`)
        const cellWidth = tcPr ? child(tcPr, 'tcW') : null
        const cellWidthValue = measure(cellWidth, 'w')
        const cellWidthType = cellWidth?.getAttributeNS(W, 'type') ?? cellWidth?.getAttribute('w:type')
        if (!proportional && cellWidthType === 'dxa' && cellWidthValue !== undefined) {
          styles.push(`width:${twipsToPt(cellWidthValue)}pt`)
        }
        const inner = await this.renderBlocks(Array.from(cell.children))
        const tag = header ? 'th' : 'td'
        cells.push(
          `<${tag}${span > 1 ? ` colspan="${span}"` : ''} style="${styles.join(';')}">${inner || '<p></p>'}</${tag}>`
        )
      }
      const rowStyle = heightValue !== undefined ? ` style="height:${twipsToPt(heightValue)}pt"` : ''
      rows.push(`<tr${rowStyle}>${cells.join('')}</tr>`)
    }
    const colgroup = columns.length > 0 ? `<colgroup>${columns.join('')}</colgroup>` : ''
    return `<table style="${tableStyles.join(';')}">${colgroup}<tbody>${rows.join('')}</tbody></table>`
  }
}

/** A numeric OOXML attribute, tolerating the "100%" form newer files use. */
function measure(element: Element | null | undefined, name: string): number | undefined {
  if (!element) return undefined
  const raw = element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`)
  if (raw === null) return undefined
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
}

/** The rules Word draws between cells rather than around the table. */
function readInsideBorders(borders: Element | null): { horizontal?: string; vertical?: string } {
  if (!borders) return {}
  const read = (name: string): string | undefined => {
    const border = child(borders, name)
    if (!border) return undefined
    return cssBorder(border)
  }
  return { horizontal: read('insideH'), vertical: read('insideV') }
}

/**
 * Word border definitions as CSS, per side. "nil" and "none" mean the author
 * asked for no line, which is different from not saying anything at all.
 */
function readBorders(borders: Element | null): Record<string, string> {
  if (!borders) return {}
  const out: Record<string, string> = {}
  const sides: [string, string][] = [
    ['top', 'top'],
    ['bottom', 'bottom'],
    ['left', 'left'],
    ['start', 'left'],
    ['right', 'right'],
    ['end', 'right']
  ]
  for (const [name, side] of sides) {
    const border = child(borders, name)
    if (!border) continue
    out[side] = cssBorder(border)
  }
  return out
}

function cssBorder(border: Element): string {
  const style = val(border) ?? 'single'
  if (style === 'nil' || style === 'none') return 'none'
  // w:sz is in eighths of a point, and Word draws a hairline for tiny values.
  const points = Math.max(0.5, (measure(border, 'sz') ?? 4) / 8)
  const colorAttribute = border.getAttributeNS(W, 'color') ?? border.getAttribute('w:color')
  const color = colorAttribute && colorAttribute !== 'auto' ? `#${colorAttribute}` : '#000000'
  const line = style === 'dashed' || style === 'dotted' || style === 'double' ? style : 'solid'
  return `${Math.round(points * 100) / 100}pt ${line} ${color}`
}

/* ------------------------------------------------------------ properties */

function child(element: Element | null | undefined, name: string): Element | null {
  if (!element) return null
  for (const node of Array.from(element.children)) if (node.namespaceURI === W && node.localName === name) return node
  return null
}

function val(element: Element | null | undefined): string | null {
  if (!element) return null
  return element.getAttributeNS(W, 'val') ?? element.getAttribute('w:val')
}

function flag(element: Element | null | undefined): boolean | undefined {
  if (!element) return undefined
  const value = val(element)
  return value === null || value === 'true' || value === '1' || value === 'on'
}

function readRunProps(rPr: Element): RunProps {
  const props: RunProps = {}
  const fonts = child(rPr, 'rFonts')
  if (fonts) {
    const ascii = fonts.getAttributeNS(W, 'ascii') ?? fonts.getAttribute('w:ascii') ?? fonts.getAttributeNS(W, 'hAnsi') ?? fonts.getAttribute('w:hAnsi')
    const cs = fonts.getAttributeNS(W, 'cs') ?? fonts.getAttribute('w:cs')
    if (ascii) props.font = ascii
    if (cs) props.fontCs = cs
  }
  const size = val(child(rPr, 'sz'))
  if (size) props.size = Number(size) / 2
  const sizeCs = val(child(rPr, 'szCs'))
  if (sizeCs) props.sizeCs = Number(sizeCs) / 2
  const bold = flag(child(rPr, 'b'))
  if (bold !== undefined) props.bold = bold
  const boldCs = flag(child(rPr, 'bCs'))
  if (boldCs !== undefined) props.boldCs = boldCs
  const italic = flag(child(rPr, 'i'))
  if (italic !== undefined) props.italic = italic
  const italicCs = flag(child(rPr, 'iCs'))
  if (italicCs !== undefined) props.italicCs = italicCs
  const underline = child(rPr, 'u')
  if (underline) props.underline = (val(underline) ?? 'single') !== 'none'
  const strike = flag(child(rPr, 'strike')) ?? flag(child(rPr, 'dstrike'))
  if (strike !== undefined) props.strike = strike
  const color = val(child(rPr, 'color'))
  if (color && color !== 'auto') props.color = `#${color}`
  const highlight = val(child(rPr, 'highlight'))
  if (highlight && highlight !== 'none') props.highlight = HIGHLIGHTS[highlight] ?? highlight
  const shade = child(rPr, 'shd')
  const fill = shade?.getAttributeNS(W, 'fill') ?? shade?.getAttribute('w:fill')
  if (fill && fill !== 'auto') props.shade = `#${fill}`
  const vertAlign = val(child(rPr, 'vertAlign'))
  if (vertAlign === 'superscript' || vertAlign === 'subscript') props.vertAlign = vertAlign
  const rtl = flag(child(rPr, 'rtl'))
  if (rtl !== undefined) props.rtl = rtl
  return props
}

function readParaProps(pPr: Element | null): ParaProps {
  const props: ParaProps = {}
  if (!pPr) return props
  const style = val(child(pPr, 'pStyle'))
  if (style) props.styleId = style
  const align = val(child(pPr, 'jc'))
  if (align) props.align = align
  const bidi = flag(child(pPr, 'bidi'))
  if (bidi !== undefined) props.bidi = bidi
  const indent = child(pPr, 'ind')
  if (indent) {
    const read = (name: string): number | undefined => {
      const value = indent.getAttributeNS(W, name) ?? indent.getAttribute(`w:${name}`)
      return value ? Number(value) : undefined
    }
    props.indentLeft = read('left') ?? read('start')
    props.indentRight = read('right') ?? read('end')
    props.firstLine = read('firstLine')
    props.hanging = read('hanging')
  }
  const spacing = child(pPr, 'spacing')
  if (spacing) {
    const read = (name: string): string | null => spacing.getAttributeNS(W, name) ?? spacing.getAttribute(`w:${name}`)
    const before = read('before')
    const after = read('after')
    const line = read('line')
    if (before) props.before = Number(before)
    if (after) props.after = Number(after)
    if (line) props.line = Number(line)
    props.lineRule = read('lineRule') ?? undefined
  }
  const numPr = child(pPr, 'numPr')
  if (numPr) {
    props.numId = val(child(numPr, 'numId')) ?? undefined
    props.level = Number(val(child(numPr, 'ilvl')) ?? 0)
  }
  const rPr = child(pPr, 'rPr')
  if (rPr) props.runProps = readRunProps(rPr)
  return props
}

/* --------------------------------------------------------------- output */

function wrapRun(content: string, props: RunProps, text: string): string {
  const complex = props.rtl || isRtlText(text)
  const font = complex ? props.fontCs ?? props.font : props.font ?? props.fontCs
  const size = complex ? props.sizeCs ?? props.size : props.size ?? props.sizeCs
  const bold = complex ? props.boldCs ?? props.bold : props.bold ?? props.boldCs
  const italic = complex ? props.italicCs ?? props.italic : props.italic ?? props.italicCs
  const styles: string[] = []
  if (font) styles.push(`font-family:'${font.replace(/'/g, '')}'`)
  if (size) styles.push(`font-size:${size}pt`)
  if (props.color) styles.push(`color:${props.color}`)
  if (props.highlight) styles.push(`background-color:${props.highlight}`)
  else if (props.shade) styles.push(`background-color:${props.shade}`)
  let html = content
  if (bold) html = `<strong>${html}</strong>`
  if (italic) html = `<em>${html}</em>`
  if (props.underline) html = `<u>${html}</u>`
  if (props.strike) html = `<s>${html}</s>`
  if (props.vertAlign === 'superscript') html = `<sup>${html}</sup>`
  if (props.vertAlign === 'subscript') html = `<sub>${html}</sub>`
  if (styles.length > 0) html = `<span style="${styles.join(';')}">${html}</span>`
  return html
}

function cssAlign(align: string | undefined, rtl: boolean): string | null {
  switch (align) {
    case 'center':
      return 'center'
    case 'both':
    case 'distribute':
      return 'justify'
    case 'left':
      return 'left'
    case 'right':
      return 'right'
    case 'start':
      return rtl ? 'right' : 'left'
    case 'end':
      return rtl ? 'left' : 'right'
    default:
      return null
  }
}

function headingTag(styleName: string): string {
  const name = styleName.toLowerCase()
  if (name === 'title') return 'h1'
  const match = /^heading\s*(\d)/.exec(name)
  if (match) return `h${Math.min(6, Number(match[1]))}`
  return 'p'
}

function twipsToPt(twips: number): number {
  return Math.round((twips / 20) * 10) / 10
}

function isRtlText(text: string): boolean {
  const rtl = (text.match(/[֐-ࣿיִ-﷿ﹰ-﻿]/g) ?? []).length
  const ltr = (text.match(/[A-Za-zÀ-ɏ]/g) ?? []).length
  return rtl > 0 && rtl >= ltr
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}
