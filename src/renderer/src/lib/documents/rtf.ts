import { escapeHtml } from '../format'

/**
 * A compact RTF reader and writer.
 *
 * RTF is a huge specification, but the slice that real documents use is small:
 * a control-word stream with groups, a font/colour table, and escaped bytes.
 * This handles that slice — paragraphs, bold/italic/underline/strike, headings
 * by font size, alignment, lists, colours and Unicode (`\uN`) — and ignores
 * control words it does not know rather than corrupting the output.
 */

interface RunStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  size: number
  color: number
  rtl: boolean
}

const DEFAULT_STYLE: RunStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  size: 24, // half-points, i.e. 12pt
  color: 0,
  rtl: false
}

interface Paragraph {
  align: 'start' | 'center' | 'end' | 'justify'
  rtl: boolean
  listLevel: number
  isList: boolean
  runs: { text: string; style: RunStyle }[]
}

export function rtfToHtml(bytes: Uint8Array): { html: string; direction: 'rtl' | 'ltr' } {
  // RTF is 7-bit ASCII with escapes, so latin1 keeps every byte addressable.
  const source = new TextDecoder('windows-1252').decode(bytes)

  const colors = parseColorTable(source)
  let codepage = /\\ansicpg(\d+)/.exec(source)?.[1]
  const fallbackDecoder = codepage ? tryDecoder(`windows-${codepage}`) : null

  const paragraphs: Paragraph[] = []
  let current: Paragraph = newParagraph()
  let style: RunStyle = { ...DEFAULT_STYLE }
  const stack: RunStyle[] = []
  const groupIsSkipped: boolean[] = []
  let buffer = ''
  let skipDepth = 0
  let rtlDetected = false

  const flushRun = (): void => {
    if (!buffer) return
    current.runs.push({ text: buffer, style: { ...style } })
    buffer = ''
  }
  const flushParagraph = (): void => {
    flushRun()
    paragraphs.push(current)
    current = newParagraph()
    current.rtl = style.rtl
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character === '{') {
      stack.push({ ...style })
      groupIsSkipped.push(skipDepth > 0)
      continue
    }
    if (character === '}') {
      flushRun()
      const restored = stack.pop()
      if (restored) style = restored
      const wasSkipped = groupIsSkipped.pop()
      if (skipDepth > 0 && !wasSkipped) skipDepth = 0
      continue
    }

    if (character === '\\') {
      const next = source[index + 1]

      // Escaped literal characters.
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDepth === 0) buffer += next
        index += 1
        continue
      }
      // Hex-escaped byte: \'xx
      if (next === "'") {
        const hex = source.slice(index + 2, index + 4)
        const byte = Number.parseInt(hex, 16)
        if (Number.isFinite(byte) && skipDepth === 0) {
          buffer += fallbackDecoder
            ? fallbackDecoder.decode(new Uint8Array([byte]))
            : String.fromCharCode(byte)
        }
        index += 3
        continue
      }
      if (next === '~') {
        if (skipDepth === 0) buffer += ' '
        index += 1
        continue
      }
      if (next === '\n' || next === '\r') {
        flushParagraph()
        index += 1
        continue
      }

      const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(index))
      if (!match) {
        index += 1
        continue
      }
      const word = match[1]
      const parameter = match[2] === undefined ? null : Number(match[2])
      index += match[0].length - 1

      // Destinations whose contents are metadata, not body text.
      if (
        ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
         'datastore', 'listtable', 'listoverridetable', 'generator', 'xmlnstbl',
         'filetbl', 'rsidtbl', 'mmathPr'].includes(word)
      ) {
        skipDepth = 1
        continue
      }
      if (word === 'u' && parameter !== null) {
        if (skipDepth === 0) {
          buffer += String.fromCodePoint(parameter < 0 ? parameter + 65536 : parameter)
        }
        // \uN is followed by a fallback character to skip.
        if (source[index + 1] === '?') index += 1
        continue
      }
      if (skipDepth > 0) continue

      switch (word) {
        case 'par':
        case 'line':
          flushParagraph()
          break
        case 'pard':
          flushRun()
          current.align = 'start'
          current.isList = false
          current.listLevel = 0
          break
        case 'plain':
          flushRun()
          style = { ...DEFAULT_STYLE, rtl: style.rtl }
          break
        case 'b':
          flushRun()
          style.bold = parameter !== 0
          break
        case 'i':
          flushRun()
          style.italic = parameter !== 0
          break
        case 'ul':
          flushRun()
          style.underline = parameter !== 0
          break
        case 'ulnone':
          flushRun()
          style.underline = false
          break
        case 'strike':
          flushRun()
          style.strike = parameter !== 0
          break
        case 'fs':
          flushRun()
          if (parameter !== null) style.size = parameter
          break
        case 'cf':
          flushRun()
          if (parameter !== null) style.color = parameter
          break
        case 'qc':
          current.align = 'center'
          break
        case 'qr':
          current.align = 'end'
          break
        case 'qj':
          current.align = 'justify'
          break
        case 'ql':
          current.align = 'start'
          break
        case 'rtlpar':
        case 'rtlch':
          flushRun()
          style.rtl = true
          current.rtl = true
          rtlDetected = true
          break
        case 'ltrpar':
        case 'ltrch':
          flushRun()
          style.rtl = false
          current.rtl = false
          break
        case 'tab':
          buffer += '\t'
          break
        case 'ls':
        case 'listtext':
          current.isList = true
          break
        case 'ilvl':
          current.listLevel = parameter ?? 0
          break
        default:
          break
      }
      continue
    }

    if (character === '\n' || character === '\r') continue
    if (skipDepth === 0) buffer += character
  }
  flushParagraph()

  const html = renderParagraphs(paragraphs, colors)
  const text = paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
  return {
    html: html || '<p></p>',
    direction: rtlDetected || /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr'
  }
}

function newParagraph(): Paragraph {
  return { align: 'start', rtl: false, listLevel: 0, isList: false, runs: [] }
}

function tryDecoder(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label)
  } catch {
    return null
  }
}

function parseColorTable(source: string): string[] {
  const table = /\{\\colortbl([^}]*)\}/.exec(source)
  if (!table) return ['#000000']
  const colors: string[] = []
  for (const entry of table[1].split(';')) {
    const red = /\\red(\d+)/.exec(entry)
    const green = /\\green(\d+)/.exec(entry)
    const blue = /\\blue(\d+)/.exec(entry)
    if (!red || !green || !blue) {
      colors.push('#000000')
      continue
    }
    const hex = [red[1], green[1], blue[1]]
      .map((value) => Number(value).toString(16).padStart(2, '0'))
      .join('')
    colors.push(`#${hex}`)
  }
  return colors.length > 0 ? colors : ['#000000']
}

function renderParagraphs(paragraphs: Paragraph[], colors: string[]): string {
  const output: string[] = []
  let listOpen = false

  for (const paragraph of paragraphs) {
    const inner = paragraph.runs
      .filter((run) => run.text.length > 0)
      .map((run) => renderRun(run.text, run.style, colors))
      .join('')

    if (!inner.trim()) {
      if (listOpen) {
        output.push('</ul>')
        listOpen = false
      }
      output.push('<p><br /></p>')
      continue
    }

    const styleAttributes: string[] = []
    if (paragraph.align !== 'start') styleAttributes.push(`text-align:${cssAlign(paragraph.align)}`)
    const attributes = `${paragraph.rtl ? ' dir="rtl"' : ''}${
      styleAttributes.length > 0 ? ` style="${styleAttributes.join(';')}"` : ''
    }`

    if (paragraph.isList) {
      if (!listOpen) {
        output.push('<ul>')
        listOpen = true
      }
      output.push(`<li${attributes}>${inner}</li>`)
      continue
    }
    if (listOpen) {
      output.push('</ul>')
      listOpen = false
    }

    // Large, bold, short lines read as headings.
    const size = paragraph.runs[0]?.style.size ?? 24
    const tag = size >= 36 ? 'h1' : size >= 30 ? 'h2' : size >= 26 ? 'h3' : 'p'
    output.push(`<${tag}${attributes}>${inner}</${tag}>`)
  }
  if (listOpen) output.push('</ul>')
  return output.join('\n')
}

function cssAlign(align: Paragraph['align']): string {
  return align === 'center' ? 'center' : align === 'justify' ? 'justify' : align === 'end' ? 'end' : 'start'
}

function renderRun(text: string, style: RunStyle, colors: string[]): string {
  let html = escapeHtml(text).replace(/\t/g, '&emsp;')
  const inlineStyles: string[] = []
  if (style.size !== DEFAULT_STYLE.size) inlineStyles.push(`font-size:${style.size / 2}pt`)
  const color = colors[style.color]
  if (color && color !== '#000000') inlineStyles.push(`color:${color}`)
  if (inlineStyles.length > 0) html = `<span style="${inlineStyles.join(';')}">${html}</span>`
  if (style.strike) html = `<s>${html}</s>`
  if (style.underline) html = `<u>${html}</u>`
  if (style.italic) html = `<em>${html}</em>`
  if (style.bold) html = `<strong>${html}</strong>`
  return html
}

/* ------------------------------------------------------------------ writer */

/** Serializes editor HTML into RTF that Word and TextEdit both open. */
export function htmlToRtf(html: string, rightToLeft: boolean): Uint8Array {
  const container = document.createElement('div')
  container.innerHTML = html

  const colors: string[] = ['#000000']
  const body: string[] = []

  const colorIndex = (value: string): number => {
    const normalized = value.toLowerCase()
    const existing = colors.indexOf(normalized)
    if (existing !== -1) return existing
    colors.push(normalized)
    return colors.length - 1
  }

  const walkInline = (node: Node, style: Partial<RunStyle>): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return encodeRtfText(node.textContent ?? '', style)
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const element = node as HTMLElement
    const tag = element.tagName
    if (tag === 'BR') return '\\line '

    const next: Partial<RunStyle> = { ...style }
    if (tag === 'B' || tag === 'STRONG') next.bold = true
    if (tag === 'I' || tag === 'EM') next.italic = true
    if (tag === 'U') next.underline = true
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true

    const inline = element.style
    if (inline.fontWeight && Number(inline.fontWeight) >= 600) next.bold = true
    if (inline.fontStyle === 'italic') next.italic = true
    if (inline.color) next.color = colorIndex(cssToHex(inline.color) ?? '#000000')
    if (inline.fontSize) {
      const pixels = Number.parseFloat(inline.fontSize)
      if (Number.isFinite(pixels)) next.size = Math.round(pixels * 0.75 * 2)
    }

    return Array.from(element.childNodes)
      .map((child) => walkInline(child, next))
      .join('')
  }

  const walkBlock = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) body.push(`\\pard${rightToLeft ? '\\rtlpar' : ''} ${encodeRtfText(text, {})}\\par`)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as HTMLElement
    const tag = element.tagName

    if (tag === 'HR') {
      body.push('\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\\pard')
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      Array.from(element.children).forEach((item, position) => {
        if (item.tagName !== 'LI') return
        const bullet = tag === 'UL' ? '\\bullet  ' : `${position + 1}.  `
        body.push(
          `\\pard${rightToLeft ? '\\rtlpar' : ''}\\fi-360\\li720 ${bullet}${walkInline(item, {})}\\par`
        )
      })
      return
    }
    if (tag === 'TABLE') {
      // Tables degrade to tab-separated paragraphs rather than being dropped.
      element.querySelectorAll('tr').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
          walkInline(cell, { bold: cell.tagName === 'TH' })
        )
        body.push(`\\pard${rightToLeft ? '\\rtlpar' : ''} ${cells.join('\\tab ')}\\par`)
      })
      return
    }
    if (['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE'].includes(tag)) {
      const blocks = Array.from(element.childNodes).filter(
        (child) =>
          child.nodeType === Node.ELEMENT_NODE &&
          /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|HR)$/.test((child as HTMLElement).tagName)
      )
      if (blocks.length > 0) {
        Array.from(element.childNodes).forEach(walkBlock)
        return
      }
    }

    const headingSizes: Record<string, number> = { H1: 40, H2: 32, H3: 28, H4: 26, H5: 24, H6: 22 }
    const size = headingSizes[tag]
    const align = element.style.textAlign
    const alignCode =
      align === 'center' ? '\\qc' : align === 'right' ? '\\qr' : align === 'justify' ? '\\qj' : ''
    const indent = tag === 'BLOCKQUOTE' ? '\\li720' : ''
    const prefix = `\\pard${rightToLeft ? '\\rtlpar' : ''}${alignCode}${indent}${
      size ? `\\b\\fs${size}` : ''
    } `
    const content = walkInline(element, size ? { bold: true, size } : {})
    body.push(`${prefix}${content}${size ? '\\b0\\fs24' : ''}\\par`)
  }

  Array.from(container.childNodes).forEach(walkBlock)

  const colorTable = colors
    .map((color) => {
      const [r, g, b] = hexTriple(color)
      return `\\red${r}\\green${g}\\blue${b};`
    })
    .join('')

  const document_ =
    `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1` +
    `{\\fonttbl{\\f0\\fswiss Calibri;}{\\f1\\froman Times New Roman;}}` +
    `{\\colortbl;${colorTable}}` +
    `\\viewkind4\\uc1\\fs24${rightToLeft ? '\\rtlpar\\rtlch' : ''}\n` +
    body.join('\n') +
    '}'

  return new TextEncoder().encode(document_)
}

/**
 * RTF is a 7-bit format: anything above ASCII has to travel as `\uN` escapes,
 * which is exactly what makes Arabic survive the round trip.
 */
function encodeRtfText(text: string, style: Partial<RunStyle>): string {
  let output = ''
  if (style.bold) output += '\\b '
  if (style.italic) output += '\\i '
  if (style.underline) output += '\\ul '
  if (style.strike) output += '\\strike '
  if (style.size) output += `\\fs${style.size} `
  if (style.color) output += `\\cf${style.color} `

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\') output += '\\\\'
    else if (character === '{') output += '\\{'
    else if (character === '}') output += '\\}'
    else if (character === '\n') output += '\\line '
    else if (character === '\t') output += '\\tab '
    else if (code < 128) output += character
    else if (code <= 0xffff) output += `\\u${code}?`
    else {
      // Astral plane: emit the surrogate pair, which RTF readers recombine.
      const value = code - 0x10000
      output += `\\u${0xd800 + (value >> 10)}?\\u${0xdc00 + (value & 0x3ff)}?`
    }
  }

  if (style.color) output += '\\cf0 '
  if (style.size) output += '\\fs24 '
  if (style.strike) output += '\\strike0 '
  if (style.underline) output += '\\ulnone '
  if (style.italic) output += '\\i0 '
  if (style.bold) output += '\\b0 '
  return output
}

function cssToHex(value: string): string | null {
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value)
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return /^#[0-9a-f]{3,6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null
}

function hexTriple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}
