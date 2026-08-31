import type { PickedFile } from '@shared/types'
import { translate, type TranslationKey } from '../i18n'
import { useApp } from '../store/app'

/**
 * Filter labels are shown by the OS file dialog, so they follow the app's
 * language. They are stored as translation keys and resolved at the moment the
 * dialog opens, which is the only point where the current language is known.
 */
function localizeFilters(filters: FileFilter[]): FileFilter[] {
  const language = useApp.getState().settings.language
  return filters.map((filter) => ({
    ...filter,
    name: filter.name.startsWith('file.')
      ? translate(language, filter.name as TranslationKey)
      : filter.name
  }))
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export const FILTERS: Record<
  'pdf' | 'word' | 'images' | 'text' | 'html' | 'documents' | 'any',
  FileFilter[]
> = {
  pdf: [{ name: 'file.pdf', extensions: ['pdf'] }],
  word: [{ name: 'file.word', extensions: ['docx', 'doc'] }],
  images: [{ name: 'file.images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  text: [{ name: 'file.text', extensions: ['txt', 'md', 'markdown'] }],
  html: [{ name: 'file.html', extensions: ['html', 'htm'] }],
  documents: [
    { name: 'file.supported', extensions: ['pdf', 'docx', 'doc', 'txt', 'md', 'html', 'htm'] },
    { name: 'file.pdf', extensions: ['pdf'] },
    { name: 'file.word', extensions: ['docx', 'doc'] }
  ],
  any: [{ name: 'file.all', extensions: ['*'] }]
}

export async function pickFiles(
  filters: FileFilter[],
  multiple = false,
  title?: string
): Promise<PickedFile[]> {
  return window.alcode.dialog.open({ multiple, title, filters: localizeFilters(filters) })
}

export async function pickOneFile(
  filters: FileFilter[],
  title?: string
): Promise<PickedFile | null> {
  const files = await pickFiles(filters, false, title)
  return files[0] ?? null
}

export interface SaveOutcome {
  saved: boolean
  path?: string
}

export async function saveBytes(
  bytes: Uint8Array,
  defaultName: string,
  filters: FileFilter[]
): Promise<SaveOutcome> {
  const result = await window.alcode.dialog.save({
    defaultName,
    filters: localizeFilters(filters)
  })
  if (result.canceled || !result.path) return { saved: false }
  await window.alcode.fs.write(result.path, bytes)
  return { saved: true, path: result.path }
}

export async function saveText(
  text: string,
  defaultName: string,
  filters: FileFilter[]
): Promise<SaveOutcome> {
  const result = await window.alcode.dialog.save({
    defaultName,
    filters: localizeFilters(filters)
  })
  if (result.canceled || !result.path) return { saved: false }
  await window.alcode.fs.writeText(result.path, text)
  return { saved: true, path: result.path }
}

export interface BatchSaveOutcome {
  saved: boolean
  directory?: string
  /** Files that could not be written, with the reason for each. */
  failures?: { name: string; error: string }[]
  /** How many were attempted, so the caller can say "12 of 15". */
  total?: number
  count: number
}

/**
 * Asks once for a folder, then drops every produced file into it.
 *
 * Each write is isolated: splitting a 200-page document onto a nearly-full
 * drive used to write forty files, throw, abandon the other hundred and sixty,
 * and show one generic error that never mentioned the forty. Existing files
 * are also given way to rather than overwritten — the caller asked to create
 * files, not to replace whatever happened to share a name.
 */
export async function saveBatch(
  files: { name: string; bytes: Uint8Array }[]
): Promise<BatchSaveOutcome> {
  if (files.length === 0) return { saved: false, count: 0 }
  const directory = await window.alcode.dialog.directory()
  if (!directory) return { saved: false, count: 0 }

  const separator = directory.includes('\\') ? '\\' : '/'
  const failures: { name: string; error: string }[] = []
  const taken = new Set<string>()
  let written = 0

  for (const file of files) {
    const name = await freeName(directory, separator, sanitize(file.name), taken)
    taken.add(name.toLowerCase())
    try {
      await window.alcode.fs.write(`${directory}${separator}${name}`, file.bytes)
      written += 1
    } catch (error) {
      failures.push({ name, error: (error as Error)?.message ?? String(error) })
    }
  }

  return { saved: written > 0, directory, count: written, failures, total: files.length }
}

/** `report.pdf` → `report (2).pdf` when the first name is already in use. */
async function freeName(
  directory: string,
  separator: string,
  name: string,
  taken: Set<string>
): Promise<string> {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  for (let attempt = 1; attempt <= 200; attempt += 1) {
    const candidate = attempt === 1 ? name : `${stem} (${attempt})${extension}`
    if (taken.has(candidate.toLowerCase())) continue
    try {
      if (!(await window.alcode.fs.exists(`${directory}${separator}${candidate}`))) return candidate
    } catch {
      return candidate
    }
  }
  return name
}

/**
 * Makes a name safe on every platform this app ships to. Windows additionally
 * refuses its reserved device names and any trailing dot or space, and the
 * extension has to survive the length cap or the file stops opening.
 */
export function sanitize(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')

  const dot = cleaned.lastIndexOf('.')
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned
  const extension = dot > 0 ? cleaned.slice(dot, dot + 24) : ''
  const safeStem = RESERVED.test(stem) ? `_${stem}` : stem
  const limit = Math.max(1, 180 - extension.length)
  return (safeStem.slice(0, limit) || 'file') + extension
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * The one line a batch tool reports, which never claims more than happened.
 * Returns undefined when the user cancelled the folder picker.
 */
export function describeBatch(
  outcome: BatchSaveOutcome,
  t: (key: 'msg.filesCreated' | 'msg.filesPartial', vars?: Record<string, string | number>) => string
): string | undefined {
  if (!outcome.saved && (outcome.failures?.length ?? 0) === 0) return undefined
  const failed = outcome.failures?.length ?? 0
  if (failed === 0) return t('msg.filesCreated', { n: outcome.count })
  return t('msg.filesPartial', {
    n: outcome.count,
    total: outcome.total ?? outcome.count + failed,
    failed
  })
}

export function imageTypeOf(name: string, bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  const lower = name.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg'
  if (lower.endsWith('.png')) return 'png'
  return null
}

/**
 * Re-encodes anything Chromium can decode (WEBP, GIF, BMP...) into PNG so it
 * can be embedded in a PDF, which only accepts PNG and JPEG.
 */
export async function normalizeImage(
  name: string,
  bytes: Uint8Array
): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' }> {
  const direct = imageTypeOf(name, bytes)
  if (direct) return { bytes, type: direct }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer])
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas-unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const output = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
  return { bytes: output, type: 'png' }
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}
