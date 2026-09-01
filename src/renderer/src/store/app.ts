import { create } from 'zustand'
import type { AppSettings, RecentFile } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { PDFDocumentProxy } from '../lib/pdf/pdfjs'

/**
 * pdf.js and its worker are a megabyte that only a PDF needs, so the module is
 * pulled in the first time one is opened rather than at startup.
 */
const pdfjs = (): Promise<typeof import('../lib/pdf/pdfjs')> => import('../lib/pdf/pdfjs')
import type { LoadedDocument } from '../lib/documents/read'
import type { SheetData } from '../lib/documents/sheets'
import type { Annotation } from '../lib/pdf/annotations'
import { translate, type TranslationKey } from '../i18n'
import { extensionOf, uid } from '../lib/format'
import { clearDraft, saveDraft } from '../lib/documents/draft'

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
  /** Stable identity for this open document, independent of name or path. */
  id: string
  name: string
  path: string | null
  bytes: Uint8Array
  password?: string
  /**
   * True when the file was encrypted on disk. Editing decrypts it, so saving
   * in place would replace a protected file with an unprotected one.
   */
  wasProtected: boolean
  /** Set once the in-memory bytes are known to have lost that protection. */
  protectionDropped: boolean
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
  /**
   * A fresh identity per load. Name+path+format is not enough: reopening the
   * same file after edits, or reverting it, produced the same key and the rich
   * editor kept showing the previous contents.
   */
  id: string
  /**
   * Bumped only by a change the editing surface did not make itself.
   *
   * The surface writes its own innerHTML on every keystroke, so it must not
   * reload on its own output — that would destroy the caret. It therefore
   * reloads on identity alone, which meant a programmatic edit (find and
   * replace, most visibly) updated the store, never reached the DOM, and was
   * overwritten by the next sync: the toast said "replaced 1" over an
   * unchanged document.
   */
  revision: number
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
  /**
   * Present when the running job can be stopped. Long jobs — OCR over a
   * hundred pages, a rasterising compress — need a way out that is not
   * killing the app.
   */
  cancel?: () => void
}

const HISTORY_LIMIT = 12
/**
 * History is capped by bytes as well as entries: twelve snapshots of a 50 MB
 * PDF would retain 600 MB. Past the budget the oldest entries are dropped.
 */
const HISTORY_BYTE_BUDGET = 192 * 1024 * 1024

/** Guards the async read-modify-write in applyPdfBytes / undo / redo. */
let mutationGeneration = 0

/**
 * Autosave is debounced rather than run per keystroke: a document is written
 * once the typing pauses, not five times a second. The draft is dropped as
 * soon as the document is saved or closed, so a stale one is never offered.
 */
let draftTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_DELAY = 2500

function scheduleDraft(read: () => AppState & AppActions): void {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    draftTimer = null
    const doc = read().editorDoc
    if (!doc || !doc.dirty) return
    void saveDraft({
      name: doc.source.name,
      path: doc.source.path,
      format: doc.source.format,
      kind: doc.source.kind,
      html: doc.html,
      text: doc.text,
      sheets: doc.sheets,
      direction: doc.direction
    })
  }, AUTOSAVE_DELAY)
}

function dropDraft(): void {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  void clearDraft()
}

function pushHistory(stack: Uint8Array[], entry: Uint8Array): Uint8Array[] {
  // A single snapshot larger than the whole budget would evict everything and
  // still not fit — skip it and degrade to no undo for that step.
  if (entry.byteLength > HISTORY_BYTE_BUDGET) return stack

  const next = [...stack, entry].slice(-HISTORY_LIMIT)
  let total = next.reduce((sum, item) => sum + item.byteLength, 0)
  while (next.length > 1 && total > HISTORY_BYTE_BUDGET) {
    total -= next[0].byteLength
    next.shift()
  }
  return next
}

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

  /**
   * Pending annotations live here rather than in the view, so switching route
   * no longer silently destroys unflattened work.
   */
  annotations: Annotation[]
  selectedAnnotation: string | null

  editorDoc: EditorDoc | null

  /**
   * The tool panel that is open, in the store rather than in ToolsView so the
   * command palette can open one directly instead of dropping the user on a
   * grid of tiles to find it in again.
   */
  activeTool: string | null

  /** Set when a file needs a password before it can be opened. */
  passwordPrompt: { name: string; bytes: Uint8Array; path: string | null; wrong: boolean } | null

  /**
   * A pending question the user must answer before a destructive action runs.
   * Set by `confirm`, cleared by the dialog's answer.
   */
  confirmPrompt: {
    title: string
    body: string
    confirmLabel: string
    danger: boolean
    resolve: (accepted: boolean) => void
  } | null

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
  setAnnotations: (annotations: Annotation[]) => void
  setSelectedAnnotation: (id: string | null) => void
  resolvePassword: (password: string) => Promise<void>
  cancelPassword: () => void

  confirm: (options: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>
  answerConfirm: (accepted: boolean) => void
  /** True when nothing would be lost, or the user accepted losing it. */
  confirmDiscard: () => Promise<boolean>

  /** Opens a tool panel, refusing the ones that need a document when none is open. */
  openTool: (id: string, needsDocument: boolean) => void
  closeTool: () => void

  openEditorDocument: (loaded: LoadedDocument) => void
  updateEditorHtml: (html: string) => void
  /** For content the editing surface did not type: it must reload to show it. */
  replaceEditorHtml: (html: string) => void
  updateEditorSheets: (sheets: SheetData[]) => void
  updateEditorText: (text: string) => void
  setActiveSheet: (index: number) => void
  setEditorDirection: (direction: 'rtl' | 'ltr') => void
  closeEditor: () => void
  markEditorSaved: (path: string, name?: string) => void
}

/**
 * A scan looks like a normal PDF until you try to search it. Sampling the
 * first few pages costs almost nothing and lets the app say so up front,
 * rather than leaving the user to conclude that search is broken.
 */
async function announceIfScanned(proxy: PDFDocumentProxy): Promise<void> {
  try {
    const sample = Math.min(proxy.numPages, 3)
    const texts: string[] = []
    for (let pageNumber = 1; pageNumber <= sample; pageNumber += 1) {
      const page = await proxy.getPage(pageNumber)
      const content = await page.getTextContent()
      texts.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join('')
      )
      page.cleanup()
    }
    const perPage = texts.reduce((sum, text) => sum + text.replace(/\s+/g, '').length, 0) / sample
    if (perPage >= 24) return
    const state = useApp.getState()
    state.notify({
      kind: 'info',
      title: state.t('msg.looksScanned'),
      message: state.t('msg.looksScannedHint')
    })
  } catch {
    /* detection is a convenience; never let it break opening a file */
  }
}

/**
 * Turns an internal failure into something a person can act on.
 *
 * The slugs are what the document and PDF layers throw; the errno prefixes are
 * what the operating system reports through the file IPC, and without them an
 * Arabic user was shown
 * `Error invoking remote method 'fs:write': Error: ENOSPC…`.
 */
function explain(message: string): TranslationKey | null {
  const exact: Record<string, TranslationKey> = {
    'invalid-range': 'msg.invalidRange',
    'no-pages-selected': 'msg.selectPages',
    'no-text-found': 'msg.noText',
    'pdf-password-required': 'msg.needPassword',
    'password-required': 'msg.needPassword',
    'wrong-password': 'msg.wrongPassword',
    'write-not-permitted': 'msg.writeNotPermitted',
    'cannot-delete-all-pages': 'msg.cannotDeleteAllPages',
    'no-sheet-data': 'msg.noSheetData',
    'unsupported-export-target': 'msg.unsupportedTarget',
    'unsupported-preview-type': 'msg.unsupportedTarget',
    'invalid-page-order': 'msg.invalidRange',
    'canvas-unavailable': 'msg.canvasUnavailable',
    'flatten-failed': 'msg.flattenFailed'
  }
  if (exact[message]) return exact[message]

  const patterns: [RegExp, TranslationKey][] = [
    [/ENOSPC/, 'msg.diskFull'],
    [/EACCES|EPERM|EROFS/, 'msg.noPermission'],
    [/ENOENT/, 'msg.fileMissing'],
    [/EBUSY|ETXTBSY/, 'msg.fileBusy'],
    [/print-timeout/, 'msg.printTimeout'],
    [/InvalidPDF|FormatError|Invalid PDF/i, 'msg.brokenPdf'],
    [/epub-|pptx-|odt-|doc-no-text/, 'msg.unreadableDocument'],
    [/password|encrypt/i, 'msg.needPassword']
  ]
  for (const [pattern, key] of patterns) if (pattern.test(message)) return key
  return null
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
  annotations: [],
  selectedAnnotation: null,

  editorDoc: null,
  activeTool: null,
  passwordPrompt: null,
  confirmPrompt: null,

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
    const key = explain(message)
    set({ busy: null })
    get().notify({
      kind: 'error',
      title: t('msg.error'),
      // An unrecognised failure still says something in the user's language;
      // the raw text follows so a bug report has something to go on.
      message: key ? t(key) : `${t('msg.unexpected')} — ${message}`
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
      const { openForRender } = await pdfjs()
      const proxy = await openForRender(bytes, password)
      const previous = get().doc
      if (previous) void previous.proxy.destroy()
      set({
        doc: {
          id: uid(),
          name,
          path,
          bytes,
          password,
          wasProtected: password !== undefined,
          protectionDropped: false,
          proxy,
          pageCount: proxy.numPages,
          dirty: false,
          version: 0
        },
        undoStack: [],
        redoStack: [],
        selectedPages: [],
        currentPage: 1,
        annotations: [],
        selectedAnnotation: null,
        passwordPrompt: null
      })
      void announceIfScanned(proxy)
      return true
    } catch (error) {
      const { PasswordRequiredError } = await pdfjs()
      if (error instanceof PasswordRequiredError) {
        set({ passwordPrompt: { name, bytes, path, wrong: error.wrong } })
        return false
      }
      get().reportError(error)
      return false
    }
  },

  async applyPdfBytes(bytes, options) {
    const generation = ++mutationGeneration
    const current = get().doc
    if (!current) return

    const { openForRender } = await pdfjs()
    const proxy = await openForRender(bytes, current.password)

    // Another mutation started while this one was parsing. Drop this result
    // rather than clobbering the newer document and leaking its proxy.
    if (generation !== mutationGeneration) {
      void proxy.destroy()
      return
    }

    const latest = get().doc
    if (!latest) {
      void proxy.destroy()
      return
    }
    void latest.proxy.destroy()

    set({
      doc: {
        ...latest,
        bytes,
        proxy,
        pageCount: proxy.numPages,
        dirty: !options?.markClean,
        // Any mutation of a protected document decrypts it.
        protectionDropped: latest.protectionDropped || latest.wasProtected,
        version: latest.version + 1
      },
      undoStack: pushHistory(get().undoStack, latest.bytes),
      redoStack: [],
      selectedPages: [],
      currentPage: Math.min(get().currentPage, proxy.numPages)
    })
  },

  async undo() {
    await stepHistory(get, set, 'undo')
  },

  async redo() {
    await stepHistory(get, set, 'redo')
  },

  closePdf() {
    const doc = get().doc
    if (doc) void doc.proxy.destroy()
    set({ doc: null, undoStack: [], redoStack: [], selectedPages: [], currentPage: 1, annotations: [] })
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

  setAnnotations(annotations) {
    set({ annotations })
  },

  setSelectedAnnotation(id) {
    set({ selectedAnnotation: id })
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

  confirm(options) {
    return new Promise<boolean>((resolve) => {
      set({
        confirmPrompt: {
          title: options.title,
          body: options.body,
          confirmLabel: options.confirmLabel,
          danger: options.danger ?? false,
          resolve
        }
      })
    })
  },

  answerConfirm(accepted) {
    const prompt = get().confirmPrompt
    set({ confirmPrompt: null })
    prompt?.resolve(accepted)
  },

  async confirmDiscard() {
    const { doc, editorDoc, annotations, t } = get()
    // Annotations that have not been flattened are unsaved work too.
    if (!doc?.dirty && !editorDoc?.dirty && annotations.length === 0) return true
    const name = doc?.dirty || annotations.length > 0 ? (doc?.name ?? '') : (editorDoc?.source.name ?? '')
    return get().confirm({
      title: t('msg.unsavedTitle'),
      body: t('msg.unsavedBody') + (name ? ' — ' + name : ''),
      confirmLabel: t('msg.discard'),
      danger: true
    })
  },

  openTool(id, needsDocument) {
    if (needsDocument && !get().doc) {
      get().notify({ kind: 'info', title: get().t('msg.noDocument') })
      return
    }
    set({ route: 'tools', activeTool: id, paletteOpen: false })
  },

  closeTool() {
    set({ activeTool: null })
  },

  openEditorDocument(loaded) {
    set({
      editorDoc: {
        id: uid(),
        revision: 0,
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
    scheduleDraft(get)
  },

  replaceEditorHtml(html) {
    const doc = get().editorDoc
    if (!doc || doc.html === html) return
    set({ editorDoc: { ...doc, html, dirty: true, revision: doc.revision + 1 } })
    scheduleDraft(get)
  },

  updateEditorSheets(sheets) {
    const doc = get().editorDoc
    if (!doc) return
    set({ editorDoc: { ...doc, sheets, dirty: true } })
    scheduleDraft(get)
  },

  updateEditorText(text) {
    const doc = get().editorDoc
    if (!doc || doc.text === text) return
    set({ editorDoc: { ...doc, text, dirty: true } })
    scheduleDraft(get)
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
    dropDraft()
    set({ editorDoc: null })
  },

  markEditorSaved(path, name) {
    const doc = get().editorDoc
    if (!doc) return
    // Saved to a real file, so the recovery copy has nothing left to recover.
    dropDraft()
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

/**
 * Undo and redo are the same move in opposite directions, and both race the
 * same way as applyPdfBytes — so they share one generation-guarded body.
 */
async function stepHistory(
  get: () => AppState & AppActions,
  set: (partial: Partial<AppState>) => void,
  direction: 'undo' | 'redo'
): Promise<void> {
  const generation = ++mutationGeneration
  const state = get()
  const doc = state.doc
  const source = direction === 'undo' ? state.undoStack : state.redoStack
  if (!doc || source.length === 0) return

  const target = source[source.length - 1]
  const { openForRender } = await import('../lib/pdf/pdfjs')
  const proxy = await openForRender(target, doc.password)

  if (generation !== mutationGeneration) {
    void proxy.destroy()
    return
  }
  const latest = get().doc
  if (!latest) {
    void proxy.destroy()
    return
  }
  void latest.proxy.destroy()

  const from = direction === 'undo' ? get().undoStack : get().redoStack
  const to = direction === 'undo' ? get().redoStack : get().undoStack
  const rewound = { ...latest, bytes: target, proxy, pageCount: proxy.numPages, dirty: true, version: latest.version + 1 }

  set({
    doc: rewound,
    undoStack: direction === 'undo' ? from.slice(0, -1) : pushHistory(to, latest.bytes),
    redoStack: direction === 'undo' ? pushHistory(to, latest.bytes) : from.slice(0, -1),
    selectedPages: [],
    currentPage: 1
  })
}

function applyDocumentChrome(settings: AppSettings, dark: boolean): void {
  const root = document.documentElement
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.setAttribute('data-accent', settings.accent)
  // Present only when the user asked for it: with the attribute absent the
  // prefers-reduced-motion media query in theme.css still applies, so the OS
  // setting is honoured without the app having to mirror it.
  if (settings.reduceMotion) root.setAttribute('data-reduce-motion', 'true')
  else root.removeAttribute('data-reduce-motion')
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
