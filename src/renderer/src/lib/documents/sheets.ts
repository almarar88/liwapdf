import * as XLSX from 'xlsx'
import { escapeHtml } from '../format'
import { detectDirection } from '../text/encoding'

/**
 * Spreadsheet reading and writing on top of SheetJS.
 *
 * Everything is normalised to a rectangular grid of strings so the editor can
 * render one table component regardless of whether the source was XLSX, ODS,
 * legacy XLS or a delimited text file.
 */

export interface SheetData {
  name: string
  rows: string[][]
}

export interface SheetsReadResult {
  sheets: SheetData[]
  direction: 'rtl' | 'ltr'
}

const MAX_ROWS = 20000
const MAX_COLUMNS = 512

export function readWorkbook(bytes: Uint8Array): SheetsReadResult {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellText: true })
  const sheets: SheetData[] = []

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      blankrows: true,
      defval: '',
      raw: false
    })

    const rows = grid
      .slice(0, MAX_ROWS)
      .map((row) => (row ?? []).slice(0, MAX_COLUMNS).map((cell) => String(cell ?? '')))

    sheets.push({ name, rows: padGrid(rows) })
  }

  if (sheets.length === 0) sheets.push({ name: 'Sheet1', rows: emptyGrid(24, 8) })

  const sample = sheets[0].rows
    .slice(0, 60)
    .map((row) => row.join(' '))
    .join('\n')

  return { sheets, direction: detectDirection(sample) }
}

/** Parses a delimited text file, honouring quoted fields and embedded newlines. */
export function readDelimited(text: string, delimiter: ',' | '\t'): SheetsReadResult {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

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
    } else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (character !== '\r') {
      field += character
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return {
    sheets: [{ name: 'Sheet1', rows: padGrid(rows.slice(0, MAX_ROWS)) }],
    direction: detectDirection(text.slice(0, 4000))
  }
}

export function writeDelimited(sheet: SheetData, delimiter: ',' | '\t'): string {
  const needsQuote = new RegExp(`["\\n\\r${delimiter === '\t' ? '\\t' : ','}]`)
  return sheet.rows
    .map((row) =>
      row
        .map((cell) => (needsQuote.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(delimiter)
    )
    .join('\r\n')
}

export function writeWorkbook(sheets: SheetData[], format: 'xlsx' | 'ods'): Uint8Array {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(trimGrid(sheet.rows))
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name))
  }
  const output = XLSX.write(workbook, { bookType: format, type: 'array' })
  return new Uint8Array(output as ArrayBuffer)
}

export function sheetsToHtml(sheets: SheetData[], rightToLeft: boolean): string {
  return sheets
    .map((sheet) => {
      const rows = trimGrid(sheet.rows)
      if (rows.length === 0) return `<h2>${escapeHtml(sheet.name)}</h2>`
      const [header, ...body] = rows
      return (
        `<h2>${escapeHtml(sheet.name)}</h2>` +
        `<table${rightToLeft ? ' dir="rtl"' : ''}>` +
        `<thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>` +
        `<tbody>${body
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
    })
    .join('\n')
}

/** Trailing empty rows and columns are editor scaffolding, not data. */
export function trimGrid(rows: string[][]): string[][] {
  let lastRow = -1
  let lastColumn = -1
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (cell !== '') {
        lastRow = Math.max(lastRow, rowIndex)
        lastColumn = Math.max(lastColumn, columnIndex)
      }
    })
  })
  if (lastRow === -1) return []
  return rows.slice(0, lastRow + 1).map((row) => {
    const trimmed = row.slice(0, lastColumn + 1)
    while (trimmed.length < lastColumn + 1) trimmed.push('')
    return trimmed
  })
}

/** Squares off a ragged grid and guarantees a minimum editable area. */
export function padGrid(rows: string[][], minRows = 20, minColumns = 6): string[][] {
  const columns = Math.max(minColumns, ...rows.map((row) => row.length), 1)
  const output = rows.map((row) => {
    const copy = [...row]
    while (copy.length < columns) copy.push('')
    return copy
  })
  while (output.length < minRows) output.push(new Array(columns).fill(''))
  return output
}

export function emptyGrid(rows: number, columns: number): string[][] {
  return Array.from({ length: rows }, () => new Array(columns).fill(''))
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
