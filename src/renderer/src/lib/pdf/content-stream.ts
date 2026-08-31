/**
 * A PDF content-stream lexer and surgical editor.
 *
 * Everything else in the app draws *onto* a page. Redaction has to reach
 * *into* it: painting a black rectangle over a paragraph leaves every one of
 * its characters in the file, recoverable with any text extractor — including
 * this app's own. To actually destroy the content we have to find the
 * text-showing operators whose glyphs fall inside the region and delete them
 * from the page's instruction stream.
 *
 * That means walking the stream while tracking the same state a renderer would
 * (the CTM stack, the text and line matrices, the current font and its
 * spacing), so each operator can be given a bounding box in page space. This
 * module does the walking and hands back byte ranges; `redact.ts` decides what
 * to do with them.
 *
 * Bytes are carried as latin1 strings so that string index === byte offset,
 * which keeps the splice arithmetic exact for the binary payloads (inline
 * images, hex strings, embedded CMaps) that appear mid-stream.
 */

export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** `m` applied first, then `n` — i.e. the PDF `m x n` product. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    e: m.e * n.a + m.f * n.c + n.e,
    f: m.e * n.b + m.f * n.d + n.f
  }
}

export function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

export function invertMatrix(m: Matrix): Matrix | null {
  const determinant = m.a * m.d - m.b * m.c
  if (Math.abs(determinant) < 1e-12) return null
  return {
    a: m.d / determinant,
    b: -m.b / determinant,
    c: -m.c / determinant,
    d: m.a / determinant,
    e: (m.c * m.f - m.d * m.e) / determinant,
    f: (m.b * m.e - m.a * m.f) / determinant
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  )
}

/* --------------------------------------------------------------- lexing */

type TokenKind =
  | 'number'
  | 'string'
  | 'name'
  | 'array-open'
  | 'array-close'
  | 'dict-open'
  | 'dict-close'
  | 'operator'
  | 'inline-image'

export interface Token {
  kind: TokenKind
  start: number
  end: number
  /** Operator or name text; for strings, the decoded byte values as latin1. */
  text: string
  value?: number
}

const WHITESPACE = new Set([' ', '\n', '\r', '\t', '\f', '\0'])
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\'
}

function isRegular(character: string): boolean {
  return !WHITESPACE.has(character) && !DELIMITERS.has(character)
}

/** Splits a content stream into tokens, each carrying its byte range. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const character = source[index]

    if (WHITESPACE.has(character)) {
      index += 1
      continue
    }

    if (character === '%') {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1
      continue
    }

    const start = index

    if (character === '(') {
      let depth = 0
      let text = ''
      while (index < source.length) {
        const current = source[index]
        if (current === '\\') {
          const escaped = source[index + 1] ?? ''
          if (/[0-7]/.test(escaped)) {
            // Octal escapes carry the byte value literally, which matters for
            // the two-byte codes of composite fonts.
            let digits = ''
            let scan = index + 1
            while (scan < source.length && digits.length < 3 && /[0-7]/.test(source[scan])) {
              digits += source[scan]
              scan += 1
            }
            text += String.fromCharCode(Number.parseInt(digits, 8) & 0xff)
            index = scan
            continue
          }
          text += ESCAPES[escaped] ?? (escaped === '\n' || escaped === '\r' ? '' : escaped)
          index += escaped === '\r' && source[index + 2] === '\n' ? 3 : 2
          continue
        }
        if (current === '(') depth += 1
        else if (current === ')') {
          depth -= 1
          if (depth === 0) {
            index += 1
            break
          }
        }
        if (depth > 0 && !(depth === 1 && current === '(')) text += current
        index += 1
      }
      tokens.push({ kind: 'string', start, end: index, text })
      continue
    }

    if (character === '<' && source[index + 1] === '<') {
      index += 2
      tokens.push({ kind: 'dict-open', start, end: index, text: '<<' })
      continue
    }

    if (character === '>' && source[index + 1] === '>') {
      index += 2
      tokens.push({ kind: 'dict-close', start, end: index, text: '>>' })
      continue
    }

    if (character === '<') {
      index += 1
      let digits = ''
      while (index < source.length && source[index] !== '>') {
        if (!WHITESPACE.has(source[index])) digits += source[index]
        index += 1
      }
      index += 1
      if (digits.length % 2 === 1) digits += '0'
      let text = ''
      for (let position = 0; position < digits.length; position += 2) {
        text += String.fromCharCode(Number.parseInt(digits.slice(position, position + 2), 16) || 0)
      }
      tokens.push({ kind: 'string', start, end: index, text })
      continue
    }

    if (character === '[' || character === ']') {
      index += 1
      tokens.push({
        kind: character === '[' ? 'array-open' : 'array-close',
        start,
        end: index,
        text: character
      })
      continue
    }

    if (character === '/') {
      index += 1
      let text = ''
      while (index < source.length && isRegular(source[index])) {
        if (source[index] === '#' && /[0-9a-f]{2}/i.test(source.slice(index + 1, index + 3))) {
          text += String.fromCharCode(Number.parseInt(source.slice(index + 1, index + 3), 16))
          index += 3
          continue
        }
        text += source[index]
        index += 1
      }
      tokens.push({ kind: 'name', start, end: index, text })
      continue
    }

    if (character === '{' || character === '}') {
      index += 1
      continue
    }

    let word = ''
    while (index < source.length && isRegular(source[index])) {
      word += source[index]
      index += 1
    }
    if (word.length === 0) {
      index += 1
      continue
    }

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      tokens.push({ kind: 'number', start, end: index, text: word, value: Number.parseFloat(word) })
      continue
    }

    if (word === 'BI') {
      // Inline images carry raw, unescaped binary between ID and EI, so the
      // ordinary lexer cannot be trusted to walk them.
      const end = findInlineImageEnd(source, index)
      tokens.push({ kind: 'inline-image', start, end, text: 'BI' })
      index = end
      continue
    }

    tokens.push({ kind: 'operator', start, end: index, text: word })
  }

  return tokens
}

function findInlineImageEnd(source: string, afterBI: number): number {
  const idAt = source.indexOf('ID', afterBI)
  if (idAt === -1) return source.length
  let index = idAt + 3 // ID plus the single whitespace byte that follows it
  while (index < source.length) {
    const at = source.indexOf('EI', index)
    if (at === -1) return source.length
    const before = source[at - 1] ?? ' '
    const after = source[at + 2] ?? ' '
    if (WHITESPACE.has(before) && (WHITESPACE.has(after) || at + 2 >= source.length)) {
      return at + 2
    }
    index = at + 2
  }
  return source.length
}

/* --------------------------------------------------------- font metrics */

export interface FontMetrics {
  /** True for composite fonts, whose strings are read two bytes at a time. */
  twoByte: boolean
  /** Glyph advance in text-space units (1/1000 em), by character code. */
  widthOf(code: number): number
}

export const FALLBACK_FONT: FontMetrics = {
  twoByte: false,
  // Deliberately generous: over-estimating an advance widens the box we
  // consider redacted, which errs toward removing too much rather than too
  // little. The verification pass in redact.ts is what catches the reverse.
  widthOf: () => 0.6
}

/* ---------------------------------------------------------------- walking */

export interface DrawnRun {
  /** Byte range of the whole operator, operands included. */
  start: number
  end: number
  /** Bounding box in the coordinate space the walk started in. */
  box: Rect
  kind: 'text' | 'image'
  /** Replacement text that preserves layout without drawing anything. */
  neutral: string
}

interface TextState {
  font: FontMetrics
  size: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
  leading: number
  rise: number
  renderMode: number
}

function initialTextState(): TextState {
  return {
    font: FALLBACK_FONT,
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0
  }
}

export interface WalkOptions {
  /** Resolves a `/Name Tf` operand to metrics; undefined falls back. */
  fontFor: (name: string) => FontMetrics | undefined
  /** True when `/Name Do` names an image (rather than a form) XObject. */
  isImage: (name: string) => boolean
  /** Called for a form XObject so the caller can recurse into it. */
  onForm?: (name: string, ctm: Matrix) => void
  /** Transform from this stream's space to the space boxes are reported in. */
  baseMatrix?: Matrix
}

/**
 * Replays a content stream far enough to place every mark it makes, and
 * returns one entry per text run and image draw.
 */
export function walkContentStream(source: string, options: WalkOptions): DrawnRun[] {
  const tokens = tokenize(source)
  const runs: DrawnRun[] = []

  let ctm = options.baseMatrix ?? IDENTITY
  const ctmStack: Matrix[] = []
  let text = initialTextState()
  const textStack: TextState[] = []
  let textMatrix = IDENTITY
  let lineMatrix = IDENTITY

  let operands: Token[] = []
  let operandStart = -1

  const numberAt = (index: number): number => operands[index]?.value ?? 0

  const record = (start: number, end: number, box: Rect, kind: 'text' | 'image', neutral: string): void => {
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return
    runs.push({ start, end, box, kind, neutral })
  }

  /** Horizontal advance, in text-space units, of one shown string. */
  const advanceOf = (bytes: string): number => {
    const { font, size, charSpacing, wordSpacing, horizontalScale } = text
    let total = 0
    if (font.twoByte) {
      for (let index = 0; index + 1 < bytes.length; index += 2) {
        const code = (bytes.charCodeAt(index) << 8) | bytes.charCodeAt(index + 1)
        total += (font.widthOf(code) * size + charSpacing) * horizontalScale
      }
      return total
    }
    for (let index = 0; index < bytes.length; index += 1) {
      const code = bytes.charCodeAt(index)
      const spacing = charSpacing + (code === 32 ? wordSpacing : 0)
      total += (font.widthOf(code) * size + spacing) * horizontalScale
    }
    return total
  }

  const boxOfRun = (advance: number): Rect => {
    const placement = multiply(textMatrix, ctm)
    const top = text.rise + text.size * 0.95
    const bottom = text.rise - text.size * 0.3
    const corners = [
      applyMatrix(placement, 0, bottom),
      applyMatrix(placement, advance, bottom),
      applyMatrix(placement, advance, top),
      applyMatrix(placement, 0, top)
    ]
    const xs = corners.map((point) => point.x)
    const ys = corners.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }

  /** A `[ n ] TJ` that advances exactly as far as the removed glyphs did. */
  const neutralAdvance = (advance: number): string => {
    const scale = text.size * text.horizontalScale
    if (!Number.isFinite(advance) || Math.abs(scale) < 1e-9 || Math.abs(advance) < 1e-9) return ''
    const adjustment = (-advance / scale) * 1000
    return `[${adjustment.toFixed(4)}]TJ`
  }

  const showText = (bytes: string, start: number, end: number, prefix = ''): void => {
    const advance = advanceOf(bytes)
    // Render mode 3 (invisible) and 7 (clip only) put no ink on the page, but
    // they are exactly how OCR layers hide extractable text under a scan — so
    // they are redacted like any other run.
    record(start, end, boxOfRun(advance), 'text', prefix + neutralAdvance(advance))
    textMatrix = multiply({ ...IDENTITY, e: advance, f: 0 }, textMatrix)
  }

  const nextLine = (tx: number, ty: number): void => {
    lineMatrix = multiply({ ...IDENTITY, e: tx, f: ty }, lineMatrix)
    textMatrix = lineMatrix
  }

  for (const token of tokens) {
    if (token.kind !== 'operator' && token.kind !== 'inline-image') {
      if (operands.length === 0) operandStart = token.start
      operands.push(token)
      if (operands.length > 512) operands = operands.slice(-256)
      continue
    }

    if (token.kind === 'inline-image') {
      const corners = [
        applyMatrix(ctm, 0, 0),
        applyMatrix(ctm, 1, 0),
        applyMatrix(ctm, 1, 1),
        applyMatrix(ctm, 0, 1)
      ]
      const xs = corners.map((point) => point.x)
      const ys = corners.map((point) => point.y)
      record(
        token.start,
        token.end,
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        },
        'image',
        ''
      )
      operands = []
      continue
    }

    const start = operands.length > 0 ? operandStart : token.start
    const operator = token.text

    switch (operator) {
      case 'q':
        ctmStack.push(ctm)
        textStack.push({ ...text })
        break
      case 'Q':
        ctm = ctmStack.pop() ?? ctm
        text = textStack.pop() ?? text
        break
      case 'cm':
        if (operands.length >= 6) {
          const base = operands.length - 6
          ctm = multiply(
            {
              a: numberAt(base),
              b: numberAt(base + 1),
              c: numberAt(base + 2),
              d: numberAt(base + 3),
              e: numberAt(base + 4),
              f: numberAt(base + 5)
            },
            ctm
          )
        }
        break

      case 'BT':
        textMatrix = IDENTITY
        lineMatrix = IDENTITY
        break

      case 'Tf':
        if (operands.length >= 2) {
          const name = operands[operands.length - 2]
          text.font = (name?.kind === 'name' ? options.fontFor(name.text) : undefined) ?? FALLBACK_FONT
          text.size = numberAt(operands.length - 1)
        }
        break
      case 'Tc':
        text.charSpacing = numberAt(operands.length - 1)
        break
      case 'Tw':
        text.wordSpacing = numberAt(operands.length - 1)
        break
      case 'Tz':
        text.horizontalScale = numberAt(operands.length - 1) / 100
        break
      case 'TL':
        text.leading = numberAt(operands.length - 1)
        break
      case 'Ts':
        text.rise = numberAt(operands.length - 1)
        break
      case 'Tr':
        text.renderMode = numberAt(operands.length - 1)
        break

      case 'Td':
        if (operands.length >= 2) nextLine(numberAt(operands.length - 2), numberAt(operands.length - 1))
        break
      case 'TD':
        if (operands.length >= 2) {
          text.leading = -numberAt(operands.length - 1)
          nextLine(numberAt(operands.length - 2), numberAt(operands.length - 1))
        }
        break
      case 'Tm':
        if (operands.length >= 6) {
          const base = operands.length - 6
          lineMatrix = {
            a: numberAt(base),
            b: numberAt(base + 1),
            c: numberAt(base + 2),
            d: numberAt(base + 3),
            e: numberAt(base + 4),
            f: numberAt(base + 5)
          }
          textMatrix = lineMatrix
        }
        break
      case 'T*':
        nextLine(0, -text.leading)
        break

      case 'Tj':
        if (operands.length >= 1 && operands[operands.length - 1].kind === 'string') {
          showText(operands[operands.length - 1].text, start, token.end)
        }
        break

      case "'":
        if (operands.length >= 1 && operands[operands.length - 1].kind === 'string') {
          nextLine(0, -text.leading)
          showText(operands[operands.length - 1].text, start, token.end, 'T*')
        }
        break

      case '"':
        if (operands.length >= 3 && operands[operands.length - 1].kind === 'string') {
          text.wordSpacing = numberAt(operands.length - 3)
          text.charSpacing = numberAt(operands.length - 2)
          nextLine(0, -text.leading)
          showText(
            operands[operands.length - 1].text,
            start,
            token.end,
            `${text.wordSpacing} Tw ${text.charSpacing} Tc T*`
          )
        }
        break

      case 'TJ': {
        // The array's own kerning numbers shift the pen as much as the glyphs
        // do, so the run's extent has to account for both.
        let advance = 0
        let started = false
        let index = operands.length - 1
        while (index >= 0 && operands[index].kind !== 'array-open') index -= 1
        if (index < 0) break
        for (let position = index + 1; position < operands.length; position += 1) {
          const element = operands[position]
          if (element.kind === 'string') {
            advance += advanceOf(element.text)
            started = true
          } else if (element.kind === 'number') {
            advance -= ((element.value ?? 0) / 1000) * text.size * text.horizontalScale
          }
        }
        if (started) {
          record(
            operands[index].start,
            token.end,
            boxOfRun(advance),
            'text',
            neutralAdvance(advance)
          )
        }
        textMatrix = multiply({ ...IDENTITY, e: advance, f: 0 }, textMatrix)
        break
      }

      case 'Do': {
        const name = operands[operands.length - 1]
        if (name?.kind === 'name') {
          if (options.isImage(name.text)) {
            const corners = [
              applyMatrix(ctm, 0, 0),
              applyMatrix(ctm, 1, 0),
              applyMatrix(ctm, 1, 1),
              applyMatrix(ctm, 0, 1)
            ]
            const xs = corners.map((point) => point.x)
            const ys = corners.map((point) => point.y)
            record(
              start,
              token.end,
              {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
              },
              'image',
              ''
            )
          } else {
            options.onForm?.(name.text, ctm)
          }
        }
        break
      }

      default:
        break
    }

    operands = []
  }

  return runs
}

/* --------------------------------------------------------------- editing */

export interface Splice {
  start: number
  end: number
  replacement: string
}

/** Applies byte-range replacements back-to-front so earlier offsets hold. */
export function spliceAll(source: string, splices: Splice[]): string {
  const ordered = [...splices].sort((left, right) => right.start - left.start)
  let result = source
  let lastStart = Number.POSITIVE_INFINITY
  for (const splice of ordered) {
    if (splice.end > lastStart) continue // overlapping edit; the later one wins
    result = result.slice(0, splice.start) + splice.replacement + result.slice(splice.end)
    lastStart = splice.start
  }
  return result
}

export function latin1Decode(bytes: Uint8Array): string {
  let text = ''
  const chunk = 8192
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return text
}

export function latin1Encode(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff
  return bytes
}
