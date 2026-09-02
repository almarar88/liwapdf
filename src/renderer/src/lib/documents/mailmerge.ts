import type { SheetData } from './sheets'
import { escapeHtml } from '../format'

/**
 * Mail merge: one template, one spreadsheet, one document per row.
 *
 * The template marks its fields as {{name}} — the convention every mail
 * merge since WordPerfect has used, and one that survives a trip through
 * Word, Markdown and the editor's own markup untouched. The spreadsheet's
 * first row names the columns; each following row becomes a document.
 * Field names match their column case- and whitespace-insensitively, so
 * "{{ الاسم }}" finds the column "الاسم" and "{{Email}}" finds "email".
 */

const FIELD = /\{\{\s*([^{}]+?)\s*\}\}/g

function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Field names in the order they first appear. */
export function mergeFields(html: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of html.matchAll(FIELD)) {
    const name = match[1].trim()
    if (!seen.has(key(name))) {
      seen.add(key(name))
      names.push(name)
    }
  }
  return names
}

/** Fills every field from the record; an unknown field becomes empty. */
export function fillTemplate(html: string, record: Record<string, string>): string {
  const lookup = new Map(Object.entries(record).map(([name, value]) => [key(name), value]))
  return html.replace(FIELD, (_, name: string) => escapeHtml(lookup.get(key(name)) ?? ''))
}

export interface MergedDocument {
  /** File name without extension, unique within the run. */
  name: string
  html: string
  record: Record<string, string>
}

export interface MergeOptions {
  /** Column whose value names each output file; the first column by default. */
  nameField?: string
  /** Prefix for every file name, e.g. the template's own name. */
  prefix?: string
}

/** Header row as column names; every non-empty row below it as a record. */
export function sheetRecords(sheet: SheetData): { columns: string[]; records: Record<string, string>[] } {
  const [header = [], ...rows] = sheet.rows
  const columns = header.map((cell) => cell.text.trim())
  const records: Record<string, string>[] = []
  for (const row of rows) {
    if (!row.some((cell) => cell.text.trim() !== '')) continue
    const record: Record<string, string> = {}
    columns.forEach((column, index) => {
      if (column) record[column] = row[index]?.text ?? ''
    })
    records.push(record)
  }
  return { columns, records }
}

export function mergeDocuments(html: string, sheet: SheetData, options: MergeOptions = {}): MergedDocument[] {
  const { columns, records } = sheetRecords(sheet)
  const nameField = options.nameField && columns.includes(options.nameField) ? options.nameField : columns[0]
  const used = new Set<string>()
  return records.map((record, index) => {
    const raw = (nameField ? record[nameField] : '') || String(index + 1)
    const safe = raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || String(index + 1)
    let name = options.prefix ? `${options.prefix} - ${safe}` : safe
    let counter = 2
    while (used.has(name.toLowerCase())) name = `${options.prefix ? `${options.prefix} - ` : ''}${safe} (${counter++})`
    used.add(name.toLowerCase())
    return { name, html: fillTemplate(html, record), record }
  })
}
