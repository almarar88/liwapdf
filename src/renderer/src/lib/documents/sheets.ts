import * as XLSX from 'xlsx'
import { escapeHtml } from '../format'
import { detectDirection } from '../text/encoding'

/**
 * Spreadsheet reading and writing on top of SheetJS.
 *
 * Cells keep their type. An earlier version modelled a sheet as `string[][]`,
 * which meant every number, date, percentage and formula came back as a
 * display string and was written out as a text cell — silently destroying the
 * workbook on save. A cell now carries the text the user edits *and* the
 * underlying value, formula and number format, so a round trip is lossless.
 */

export interface SheetCell {
  /** What the grid shows and the user edits. */
  text: string
  /** Underlying typed value, when the cell is not plain text. */
  value?: number | boolean
  /** Formula source without the leading '='. */
  formula?: string
  /** SheetJS number-format string, preserved verbatim. */
  format?: string
  /** True when the value is an Excel date serial. */
  isDate?: boolean
}

export interface SheetData {
  name: string
  rows: SheetCell[][]
}

export interface SheetsReadResult {
  sheets: SheetData[]
  direction: 'rtl' | 'ltr'
  /** Set when the workbook exceeded the editable caps and was cut down. */
  truncated: boolean
}

export const MAX_ROWS = 20000
export const MAX_COLUMNS = 512

export function emptyCell(): SheetCell {
  return { text: '' }
}

export function cellFromText(text: string): SheetCell {
  return inferCell(text)
}

export function readWorkbook(bytes: Uint8Array): SheetsReadResult {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: true, cellNF: true })
  const sheets: SheetData[] = []
  let truncated = false

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet || !sheet['!ref']) {
      sheets.push({ name, rows: emptyGrid(24, 8) })
      continue
    }

    const range = XLSX.utils.decode_range(sheet['!ref'])

    // Walk the cells the file actually contains rather than the rectangle its
    // /!ref declares. A sheet whose last used cell is ZZ100000 declares a
    // 10-million-cell rectangle even when only a hundred cells carry data, and
    // materialising that rectangle is what made large workbooks hang.
    const cells = new Map<number, Map<number, SheetCell>>()
    let maxRow = -1
    let maxColumn = -1

    for (const address of Object.keys(sheet)) {
      if (address.charCodeAt(0) === 33 /* '!' */) continue
      const raw = sheet[address] as XLSX.CellObject | undefined
      if (!raw) continue
      let position: { r: number; c: number }
      try {
        position = XLSX.utils.decode_cell(address)
      } catch {
        continue
      }
      const r = position.r - range.s.r
      const c = position.c - range.s.c
      if (r < 0 || c < 0) continue
      if (r >= MAX_ROWS || c >= MAX_COLUMNS) {
        truncated = true
        continue
      }
      const cell = readCell(raw)
      if (cell.text === '' && cell.formula === undefined) continue
      let row = cells.get(r)
      if (!row) {
        row = new Map<number, SheetCell>()
        cells.set(r, row)
      }
      row.set(c, cell)
      if (r > maxRow) maxRow = r
      if (c > maxColumn) maxColumn = c
    }

    const rows: SheetCell[][] = []
    for (let r = 0; r <= maxRow; r += 1) {
      const source = cells.get(r)
      const row: SheetCell[] = []
      for (let c = 0; c <= maxColumn; c += 1) row.push(source?.get(c) ?? emptyCell())
      rows.push(row)
    }
    sheets.push({ name, rows: padGrid(rows) })
  }

  if (sheets.length === 0) sheets.push({ name: 'Sheet1', rows: emptyGrid(24, 8) })

  const sample = sheets[0].rows
    .slice(0, 60)
    .map((row) => row.map((cell) => cell.text).join(' '))
    .join('\n')

  return { sheets, direction: detectDirection(sample), truncated }
}

/** Reads one SheetJS cell into the editor model, keeping everything but style. */
function readCell(raw: XLSX.CellObject | undefined): SheetCell {
  if (!raw || raw.v === undefined || raw.v === null) {
    return raw?.f ? { text: '=' + raw.f, formula: raw.f } : emptyCell()
  }

  // The cached display string is what a spreadsheet app shows; fall back to the
  // raw value when the file carries no formatting.
  const display = raw.w ?? String(raw.v)

  if (raw.f) {
    return { text: display, formula: raw.f, value: typeof raw.v === 'number' ? raw.v : undefined, format: raw.z as string | undefined }
  }
  if (raw.t === 'n') {
    return {
      text: display,
      value: raw.v as number,
      format: raw.z as string | undefined,
      isDate: isDateFormat(raw.z as string | undefined)
    }
  }
  if (raw.t === 'b') return { text: display, value: raw.v as boolean }
  return { text: display }
}

function isDateFormat(format: string | undefined): boolean {
  if (!format) return false
  return /[dmyhs]/i.test(format.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))
}

/**
 * Rewrites Arabic-Indic and Persian digits, the Arabic decimal separator and
 * the Arabic thousands separator into their ASCII equivalents, so a number
 * typed in Arabic is stored as a number. The glyphs the user typed stay in
 * `cell.text`.
 */
export function foldNumerals(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
    .replace(/٪/g, '%')
}

/**
 * Turns what the user typed back into a typed cell. Mirrors the rules every
 * spreadsheet uses: a leading '=' is a formula, a bare number is numeric, and
 * anything else stays text — so IDs like "007" are not silently renumbered.
 */
export function inferCell(text: string, previous?: SheetCell): SheetCell {
  const trimmed = text.trim()
  if (!trimmed) return { text: '' }

  if (trimmed.startsWith('=')) {
    return { text, formula: trimmed.slice(1) }
  }

  // Preserve leading zeros and any explicit sign/format the user typed.
  // Arabic-Indic digits are digits: typing ١٢٣٤ used to store text with no
  // value, so SUM and AVERAGE reported zero and Excel received a string.
  const numeric = foldNumerals(trimmed).replace(/,/g, '')
  if (
    /^[-+]?\d+(\.\d+)?$/.test(numeric) &&
    !(numeric.length > 1 && /^0\d/.test(numeric.replace(/^[-+]/, '')))
  ) {
    return { text, value: Number(numeric), format: previous?.format }
  }
  if (/^[-+]?\d+(\.\d+)?%$/.test(numeric)) {
    return { text, value: Number(numeric.slice(0, -1)) / 100, format: previous?.format ?? '0.00%' }
  }
  return { text }
}

/** Parses a delimited text file, honouring quoted fields and embedded newlines. */
export function readDelimited(text: string, delimiter: ',' | '\t'): SheetsReadResult {
  const rows: SheetCell[][] = []
  let row: SheetCell[] = []
  let field = ''
  let quoted = false
  let wasQuoted = false

  const pushField = (): void => {
    // A quoted field is text by definition — that is how CSV protects "007".
    row.push(wasQuoted ? { text: field } : inferCell(field))
    field = ''
    wasQuoted = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      quoted = true
      wasQuoted = true
    } else if (character === delimiter) {
      pushField()
    } else if (character === '\n') {
      pushField()
      rows.push(row)
      row = []
    } else if (character !== '\r') {
      field += character
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField()
    rows.push(row)
  }

  return {
    sheets: [{ name: 'Sheet1', rows: padGrid(rows.slice(0, MAX_ROWS)) }],
    direction: detectDirection(text.slice(0, 4000)),
    truncated: rows.length > MAX_ROWS
  }
}

export function writeDelimited(sheet: SheetData, delimiter: ',' | '\t'): string {
  const needsQuote = new RegExp('["\\n\\r' + (delimiter === '\t' ? '\\t' : ',') + ']')
  return trimGrid(sheet.rows)
    .map((row) =>
      row
        .map((cell) => cell.text)
        .map((text) => (needsQuote.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text))
        .join(delimiter)
    )
    .join('\r\n')
}

export function writeWorkbook(sheets: SheetData[], format: 'xlsx' | 'ods'): Uint8Array {
  const workbook = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const rows = trimGrid(sheet.rows)
    const worksheet: XLSX.WorkSheet = {}
    let maxRow = 0
    let maxColumn = 0

    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const encoded = encodeCell(cell)
        if (!encoded) return
        worksheet[XLSX.utils.encode_cell({ r, c })] = encoded
        maxRow = Math.max(maxRow, r)
        maxColumn = Math.max(maxColumn, c)
      })
    })

    worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } })
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name))
  }

  const output = XLSX.write(workbook, { bookType: format, type: 'array', cellStyles: false })
  return new Uint8Array(output as ArrayBuffer)
}

/** Converts an editor cell back into a SheetJS cell, keeping type and formula. */
function encodeCell(cell: SheetCell): XLSX.CellObject | null {
  if (cell.formula) {
    const encoded: XLSX.CellObject = { t: typeof cell.value === 'number' ? 'n' : 's', f: cell.formula }
    if (cell.value !== undefined) encoded.v = cell.value as never
    else encoded.v = '' as never
    if (cell.format) encoded.z = cell.format
    return encoded
  }
  if (typeof cell.value === 'number') {
    const encoded: XLSX.CellObject = { t: 'n', v: cell.value }
    if (cell.format) encoded.z = cell.format
    if (cell.text) encoded.w = cell.text
    return encoded
  }
  if (typeof cell.value === 'boolean') return { t: 'b', v: cell.value }
  if (cell.text === '') return null
  return { t: 's', v: cell.text }
}

export function sheetsToHtml(sheets: SheetData[], rightToLeft: boolean): string {
  return sheets
    .map((sheet) => {
      const rows = trimGrid(sheet.rows)
      if (rows.length === 0) return '<h2>' + escapeHtml(sheet.name) + '</h2>'
      const [header, ...body] = rows
      return (
        '<h2>' + escapeHtml(sheet.name) + '</h2>' +
        '<table' + (rightToLeft ? ' dir="rtl"' : '') + '>' +
        '<thead><tr>' + header.map((cell) => '<th>' + escapeHtml(cell.text) + '</th>').join('') + '</tr></thead>' +
        '<tbody>' +
        body
          .map((row) => '<tr>' + row.map((cell) => '<td>' + escapeHtml(cell.text) + '</td>').join('') + '</tr>')
          .join('') +
        '</tbody></table>'
      )
    })
    .join('\n')
}

/** Trailing empty rows and columns are editor scaffolding, not data. */
export function trimGrid(rows: SheetCell[][]): SheetCell[][] {
  let lastRow = -1
  let lastColumn = -1
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (cell.text !== '' || cell.formula) {
        lastRow = Math.max(lastRow, rowIndex)
        lastColumn = Math.max(lastColumn, columnIndex)
      }
    })
  })
  if (lastRow === -1) return []
  return rows.slice(0, lastRow + 1).map((row) => {
    const trimmed = row.slice(0, lastColumn + 1)
    while (trimmed.length < lastColumn + 1) trimmed.push(emptyCell())
    return trimmed
  })
}

/** Squares off a ragged grid and guarantees a minimum editable area. */
export function padGrid(rows: SheetCell[][], minRows = 20, minColumns = 6): SheetCell[][] {
  const columns = Math.max(minColumns, ...rows.map((row) => row.length), 1)
  const output = rows.map((row) => {
    const copy = [...row]
    while (copy.length < columns) copy.push(emptyCell())
    return copy
  })
  while (output.length < minRows) {
    output.push(Array.from({ length: columns }, emptyCell))
  }
  return output
}

export function emptyGrid(rows: number, columns: number): SheetCell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, emptyCell))
}

/** Excel rejects these characters and caps sheet names at 31 chars. */
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, '_').trim()
  return (cleaned || 'Sheet').slice(0, 31)
}

/** A1, B1 … Z1, AA1 — the column label the header row shows. */
export function columnLabel(index: number): string {
  let label = ''
  let value = index
  while (value >= 0) {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  }
  return label
}

/** Numeric view of a cell, for the selection sum and average. */
export function numericValue(cell: SheetCell | undefined): number | null {
  if (!cell) return null
  if (typeof cell.value === 'number') return cell.value
  if (!cell.text) return null
  const parsed = Number(cell.text.replace(/[,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}
