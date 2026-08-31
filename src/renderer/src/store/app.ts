import { create } from 'zustand'
import type { AppSettings, RecentFile } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { openForRender, PasswordRequiredError, type PDFDocumentProxy } from '../lib/pdf/pdfjs'
import type { LoadedDocument } from '../lib/documents/read'
import type { SheetData } from '../lib/documents/sheets'
import { translate, type TranslationKey } from '../i18n'
import { extensionOf, uid } from '../lib/format'

export type Route =
  | 'home'
  | 'viewer'
  | 'organize'
  | 'annotate'
  | 'editor'
  | 'convert'
  | 'tools'
  | 'settings'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  title: string
  message?: string
  action?: { label: string; run: () => void }
}

export interface PdfDoc {
  name: string
  path: string | null
  bytes: Uint8Array
  password?: string
  proxy: PDFDocumentProxy
  pageCount: number
  dirty: boolean
  /** Bumped on every mutation so views can invalidate rendered pages. */
  version: number
}

/**
 * The live editing state for any non-PDF document. `source` is what came off
 * disk; the html/sheets/text fields are what the user has since edited, and
 * only the one matching `source.kind` is meaningful.
 */
export interface EditorDoc {
  source: LoadedDocument
  html: string
  sheets: SheetData[]
  text: string
  activeSheet: number
  direction: 'rtl' | 'ltr'
  dirty: boolean
}

export interface BusyState {
  label: string
  progress: number | null
}

const HISTORY_LIMIT = 12

interface AppState {
  settings: AppSettings
  dark: boolean
  route: Route
  sidebarCollapsed: boolean
  paletteOpen: boolean
  toasts: Toast[]
  busy: BusyState | null
  recents: RecentFile[]

  doc: PdfDoc | null
  undoStack: Uint8Array[]
  redoStack: Uint8Array[]
  selectedPages: number[]
  currentPage: number

  editorDoc: EditorDoc | null

  /** Set when a file needs a password before it can be opened. */
  passwordPrompt: { name: string; bytes: Uint8Array; path: string | null; wrong: boolean } | null

  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

interface AppActions {
  init: () => Promise<void>
  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  setDark: (dark: boolean) => void
  navigate: (route: Route) => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void

  notify: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  setBusy: (busy: BusyState | null) => void
  reportError: (error: unknown) => void

  refreshRecents: () => Promise<void>
  clearRecents: () => Promise<void>

  openPdfBytes: (
    name: string,
    bytes: Uint8Array,
    path: string | null,
    password?: string
  ) => Promise<boolean>
  applyPdfBytes: (bytes: Uint8Array, options?: { markClean?: boolean }) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  closePdf: () => void
  markSaved: (path: string, name?: string) => void
  setSelectedPages: (pages: number[]) => void
  togglePageSelection: (index: number) => void
  setCurrentPage: (page: number) => void
  resolvePassword: (password: string) => Promise<void>
  cancelPassword: () => void

  openEditorDocument: (loaded: LoadedDocument) => void
  updateEditorHtml: (html: string) => void
  updateEditorSheets: (sheets: SheetData[]) => void
  updateEditorText: (text: string) => void
  setActiveSheet: (index: number) => void
  setEditorDirection: (direction: 'rtl' | 'ltr') => void
  closeEditor: () => void
  markEditorSaved: (path: string, name?: string) => void
}

export const useApp = create<AppState & AppActions>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  dark: false,
  route: 'home',
  sidebarCollapsed: false,
  paletteOpen: false,
  toasts: [],
  busy: null,
  recents: [],

  doc: null,
  undoStack: [],
  redoStack: [],
  selectedPages: [],
  currentPage: 1,

  editorDoc: null,
  passwordPrompt: null,

  t: (key, vars) => translate(get().settings.language, key, vars),

  async init() {
    const [settings, dark, recents] = await Promise.all([
      window.alcode.settings.get(),
      window.alcode.theme.isDark(),
      window.alcode.recents.list()
    ])
    set({ settings, dark, recents })
    applyDocumentChrome(settings, dark)
  },

  async setSettings(patch) {
    const settings = await window.alcode.settings.set(patch)
    set({ settings })
    const dark =
      settings.theme === 'system' ? await window.alcode.theme.isDark() : settings.theme === 'dark'
    set({ dark })
    applyDocumentChrome(settings, dark)
  },

  setDark(dark) {
    set({ dark })
    applyDocumentChrome(get().settings, dark)
  },

  navigate(route) {
    set({ route, paletteOpen: false })
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  notify(toast) {
    const id = uid()
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    window.setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? 7000 : 4200)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  setBusy(busy) {
    set({ busy })
  },

  reportError(error) {
    const { t } = get()
    const message = error instanceof Error ? error.message : String(error)
    const friendly: Record<string, TranslationKey> = {
      'invalid-range': 'msg.invalidRange',
      'no-pages-selected': 'msg.selectPages',
      'no-text-found': 'msg.noText',
      'pdf-password-required': 'msg.needPassword',
      'wrong-password': 'msg.wrongPassword'
    }
    const key = friendly[message]
    set({ busy: null })
    get().notify({
      kind: 'error',
      title: t('msg.error'),
      message: key ? t(key) : message
    })
  },

  async refreshRecents() {
    set({ recents: await window.alcode.recents.list() })
  },

  async clearRecents() {
    set({ recents: await window.alcode.recents.clear() })
  },

  async openPdfBytes(name, bytes, path, password) {
    try {
      const proxy = await openForRender(bytes, password)
      const previous = get().doc
      if (previous) void previous.proxy.destroy()
      set({
        doc: {
          name,
          path,
          bytes,
          password,
          proxy,
          pageCount: proxy.numPages,
          dirty: false,
          version: 0
        },
        undoStack: [],
        redoStack: [],
        selectedPages: [],
        currentPage: 1,
        passwordPrompt: null
      })
      return true
    } catch (error) {
      if (error instanceof PasswordRequiredError) {
        set({ passwordPrompt: { name, bytes, path, wrong: error.wrong } })
        return false
      }
      get().reportError(error)
      return false
    }
  },

  async applyPdfBytes(bytes, options) {
    const current = get().doc
    if (!current) return
    const proxy = await openForRender(bytes, current.password)
    void current.proxy.destroy()

    const undoStack = [...get().undoStack, current.bytes].slice(-HISTORY_LIMIT)
    set({
      doc: {
        ...current,
        bytes,
        proxy,
        pageCount: proxy.numPages,
        dirty: !options?.markClean,
        version: current.version + 1
      },
      undoStack,
      redoStack: [],
      selectedPages: [],
      currentPage: Math.min(get().currentPage, proxy.numPages)
    })
  },

  async undo() {
    const { undoStack, doc } = get()
    if (!doc || undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    const proxy = await openForRender(previous, doc.password)
    void doc.proxy.destroy()
    set({
      doc: { ...doc, bytes: previous, proxy, pageCount: proxy.numPages, dirty: true, version: doc.version + 1 },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, doc.bytes].slice(-HISTORY_LIMIT),
      selectedPages: [],
      currentPage: 1
    })
  },

  async redo() {
    const { redoStack, doc } = get()
    if (!doc || redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    const proxy = await openForRender(next, doc.password)
    void doc.proxy.destroy()
    set({
      doc: { ...doc, bytes: next, proxy, pageCount: proxy.numPages, dirty: true, version: doc.version + 1 },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, doc.bytes].slice(-HISTORY_LIMIT),
      selectedPages: [],
      currentPage: 1
    })
  },

  closePdf() {
    const doc = get().doc
    if (doc) void doc.proxy.destroy()
    set({ doc: null, undoStack: [], redoStack: [], selectedPages: [], currentPage: 1 })
  },

  markSaved(path, name) {
    const doc = get().doc
    if (!doc) return
    set({ doc: { ...doc, path, name: name ?? doc.name, dirty: false } })
    void get().refreshRecents()
  },

  setSelectedPages(pages) {
    set({ selectedPages: [...new Set(pages)].sort((a, b) => a - b) })
  },

  togglePageSelection(index) {
    const selected = get().selectedPages
    set({
      selectedPages: selected.includes(index)
        ? selected.filter((page) => page !== index)
        : [...selected, index].sort((a, b) => a - b)
    })
  },

  setCurrentPage(page) {
    set({ currentPage: page })
  },

  async resolvePassword(password) {
    const prompt = get().passwordPrompt
    if (!prompt) return
    const ok = await get().openPdfBytes(prompt.name, prompt.bytes, prompt.path, password)
    if (ok) set({ passwordPrompt: null, route: 'viewer' })
  },

  cancelPassword() {
    set({ passwordPrompt: null })
  },

  openEditorDocument(loaded) {
    set({
      editorDoc: {
        source: loaded,
        html: loaded.html ?? '',
        sheets: loaded.sheets ?? [],
        text: loaded.text ?? '',
        activeSheet: 0,
        direction: loaded.direction,
        dirty: false
      }
    })
  },

  updateEditorHtml(html) {
    const doc = get().editorDoc
    if (!doc || doc.html === html) return
    set({ editorDoc: { ...doc, html, dirty: true } })
  },

  updateEditorSheets(sheets) {
    const doc = get().editorDoc
    if (!doc) return
    set({ editorDoc: { ...doc, sheets, dirty: true } })
  },

  updateEditorText(text) {
    const doc = get().editorDoc
    if (!doc || doc.text === text) return
    set({ editorDoc: { ...doc, text, dirty: true } })
  },

  setActiveSheet(index) {
    const doc = get().editorDoc
    if (!doc) return
    set({ editorDoc: { ...doc, activeSheet: index } })
  },

  setEditorDirection(direction) {
    const doc = get().editorDoc
    if (!doc) return
    set({ editorDoc: { ...doc, direction, dirty: true } })
  },

  closeEditor() {
    set({ editorDoc: null })
  },

  markEditorSaved(path, name) {
    const doc = get().editorDoc
    if (!doc) return
    set({
      editorDoc: {
        ...doc,
        dirty: false,
        source: { ...doc.source, path, name: name ?? doc.source.name }
      }
    })
    void get().refreshRecents()
  }
}))

function applyDocumentChrome(settings: AppSettings, dark: boolean): void {
  const root = document.documentElement
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.setAttribute('data-accent', settings.accent)
  root.setAttribute('data-reduce-motion', String(settings.reduceMotion))
  root.setAttribute('lang', settings.language)
  root.setAttribute('dir', settings.language === 'ar' ? 'rtl' : 'ltr')
}

export function kindOfFile(name: string): 'pdf' | 'docx' | 'image' | 'text' | 'other' {
  const extension = extensionOf(name)
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx' || extension === 'doc') return 'docx'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension)) return 'image'
  if (['txt', 'md', 'markdown', 'html', 'htm', 'rtf'].includes(extension)) return 'text'
  return 'other'
}
