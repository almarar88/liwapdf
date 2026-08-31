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
  count: number
}

/** Asks once for a folder, then drops every produced file into it. */
export async function saveBatch(
  files: { name: string; bytes: Uint8Array }[]
): Promise<BatchSaveOutcome> {
  if (files.length === 0) return { saved: false, count: 0 }
  const directory = await window.alcode.dialog.directory()
  if (!directory) return { saved: false, count: 0 }

  const separator = directory.includes('\\') ? '\\' : '/'
  for (const file of files) {
    await window.alcode.fs.write(`${directory}${separator}${sanitize(file.name)}`, file.bytes)
  }
  return { saved: true, directory, count: files.length }
}

export function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180)
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
