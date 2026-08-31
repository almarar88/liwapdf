/** Shared contracts between the Electron main process and the renderer. */

export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'ar' | 'en'

export interface AppSettings {
  theme: ThemeMode
  language: Language
  accent: string
  reduceMotion: boolean
  defaultExportDir: string | null
  rememberSession: boolean
  /**
   * Off by default because Chromium fetches its Hunspell dictionary from
   * Google's CDN the first time it is used, which would break the app's
   * "nothing leaves this machine" promise without the user ever asking.
   * macOS is exempt: it has an offline system spellchecker.
   */
  spellcheck: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'ar',
  accent: 'blue',
  reduceMotion: false,
  defaultExportDir: null,
  rememberSession: true,
  spellcheck: false
}

export interface RecentFile {
  path: string
  name: string
  kind: 'pdf' | 'docx' | 'image' | 'text' | 'other'
  size: number
  openedAt: number
}

export interface PickedFile {
  path: string
  name: string
  size: number
  /** Raw bytes of the file. */
  data: Uint8Array
}

export interface OpenDialogOptions {
  title?: string
  multiple?: boolean
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveDialogOptions {
  title?: string
  defaultName?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveResult {
  canceled: boolean
  path?: string
}

export interface PdfPrintOptions {
  landscape?: boolean
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid'
  marginsMm?: number
  printBackground?: boolean
  headerFooter?: boolean
}

export interface WindowState {
  maximized: boolean
  focused: boolean
}

/** What the renderer hands the main process to run a real print job. */
export interface PrintJobOptions {
  /** Page images, in order, as data URLs. */
  pages: { dataUrl: string; widthPt: number; heightPt: number }[]
  copies?: number
  color?: boolean
  landscape?: boolean
  deviceName?: string
  /** false shows the system print dialog, which is what a Print button means. */
  silent?: boolean
}

export interface PrinterOption {
  name: string
  displayName: string
  isDefault: boolean
}
