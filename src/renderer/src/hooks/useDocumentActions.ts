import { useCallback } from 'react'
import { useApp, type EditorDoc } from '../store/app'
import { FILTERS, pickFiles, saveBytes, type FileFilter } from '../lib/files'
import { formatInfo, type DocumentFormat, ALL_READABLE_EXTENSIONS } from '../lib/documents/formats'
import { sanitize } from '../lib/documents/sanitize'
import { stripExtension } from '../lib/format'
import type { LoadedDocument } from '../lib/documents/read'

/**
 * The document pipeline — SheetJS, mammoth, docx, JSZip — is three megabytes
 * of parsers that only matter once a file is actually opened, so it is loaded
 * at that moment rather than at startup.
 */
const readers = (): Promise<typeof import('../lib/documents/read')> =>
  import('../lib/documents/read')
const writers = (): Promise<typeof import('../lib/documents/write')> =>
  import('../lib/documents/write')

export interface DocumentActions {
  openDialog: () => Promise<void>
  openPaths: (paths: string[]) => Promise<void>
  saveActive: () => Promise<void>
  /** Always opens a dialog, whatever the document already has a path. */
  saveActiveAs: () => Promise<void>
  savePdfAs: () => Promise<void>
  exportEditorAs: (target: DocumentFormat) => Promise<void>
  newDocument: (kind: 'rich' | 'sheet' | 'code', template?: string) => Promise<void>
  /** Renders the open editor document to PDF so the PDF tools can act on it. */
  bridgeEditorToPdf: () => Promise<boolean>
}

/**
 * Every readable extension, offered as one filter plus per-family filters.
 *
 * Names are translation keys: `pickFiles` resolves them against the current
 * language, so the OS dialog stops being English-only in an Arabic UI.
 */
export function openFilters(): FileFilter[] {
  return [
    { name: 'file.supported', extensions: [...ALL_READABLE_EXTENSIONS] },
    { name: 'file.pdf', extensions: ['pdf'] },
    { name: 'file.word', extensions: ['docx', 'doc', 'rtf', 'odt'] },
    { name: 'file.sheets', extensions: ['xlsx', 'xls', 'ods', 'csv', 'tsv'] },
    { name: 'file.slides', extensions: ['pptx', 'ppsx'] },
    { name: 'file.code', extensions: ['txt', 'md', 'html', 'json', 'xml', 'yml', 'csv', 'log'] },
    { name: 'file.books', extensions: ['epub'] },
    { name: 'file.images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
    { name: 'file.all', extensions: ['*'] }
  ]
}

/**
 * The single place that knows how to turn a file on disk into the right editor,
 * and how to write whatever is open back out again.
 */
export function useDocumentActions(): DocumentActions {
  const store = useApp

  const openBytes = useCallback(
    async (name: string, bytes: Uint8Array, path: string | null): Promise<void> => {
      const state = store.getState()
      state.setBusy({ label: state.t('msg.loading'), progress: null })

      try {
        const loaded = await (await readers()).readDocument(name, bytes, path)

        if (loaded.format === 'pdf') {
          const opened = await store.getState().openPdfBytes(name, bytes, path)
          if (opened) store.getState().navigate('viewer')
          return
        }

        store.getState().openEditorDocument(loaded)
        store.getState().navigate('editor')

        for (const warning of loaded.warnings) {
          const message = WARNING_MESSAGES[warning]
          if (message) {
            store.getState().notify({ kind: 'info', title: store.getState().t(message) })
          }
        }
      } catch (error) {
        store.getState().reportError(error)
      } finally {
        store.getState().setBusy(null)
      }
    },
    [store]
  )

  const openPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!(await store.getState().confirmDiscard())) return
      for (const path of paths) {
        try {
          const file = await window.alcode.fs.read(path)
          await openBytes(file.name, file.data, file.path)
        } catch (error) {
          store.getState().reportError(error)
        }
      }
      await store.getState().refreshRecents()
    },
    [openBytes, store]
  )

  const openDialog = useCallback(async (): Promise<void> => {
    if (!(await store.getState().confirmDiscard())) return
    const files = await pickFiles(openFilters(), true)
    for (const file of files) {
      await openBytes(file.name, file.data, file.path)
    }
    await store.getState().refreshRecents()
  }, [openBytes, store])

  const savePdfAs = useCallback(async (): Promise<void> => {
    const state = store.getState()
    const doc = state.doc
    if (!doc) {
      state.notify({ kind: 'info', title: state.t('msg.noDocument') })
      return
    }
    try {
      const outcome = await saveBytes(doc.bytes, doc.name, FILTERS.pdf)
      if (outcome.saved && outcome.path) {
        state.markSaved(outcome.path)
        announceSaved(outcome.path)
      }
    } catch (error) {
      store.getState().reportError(error)
    }
  }, [store])

  /**
   * Puts whatever is open into the shape a PDF tool can act on.
   *
   * The app keeps two document slots — the PDF one the viewer and the tools
   * use, and the editor one everything else lives in — and they never spoke to
   * each other. So with a Word file plainly open on screen, every tool refused
   * with "open a document first", which is both wrong and impossible to argue
   * with. Rendering the editor's document to PDF and handing that to the tool
   * is what the user was going to do by hand anyway.
   */
  const bridgeEditorToPdf = useCallback(async (): Promise<boolean> => {
    const state = store.getState()
    const doc = state.editorDoc
    if (!doc) return false
    if (doc.source.kind === 'image' || doc.source.kind === 'pdf') return false

    state.setBusy({ label: state.t('workspace.converting'), progress: null })
    try {
      const result = await (await writers()).exportDocument(requestFor(doc, 'pdf'))
      const opened = await store
        .getState()
        .openPdfBytes(result.fileName, result.bytes, null)
      if (opened) {
        store.getState().notify({
          kind: 'success',
          title: store.getState().t('workspace.converted', { name: doc.source.name })
        })
      }
      return opened
    } catch (error) {
      store.getState().reportError(error)
      return false
    } finally {
      store.getState().setBusy(null)
    }
  }, [store])

  const exportEditorAs = useCallback(
    async (target: DocumentFormat): Promise<void> => {
      const state = store.getState()
      const doc = state.editorDoc
      if (!doc) {
        state.notify({ kind: 'info', title: state.t('msg.noDocument') })
        return
      }

      state.setBusy({ label: state.t('msg.working'), progress: null })
      try {
        const result = await (await writers()).exportDocument(requestFor(doc, target))
        const info = formatInfo(target)
        const outcome = await saveBytes(result.bytes, result.fileName, [
          { name: info?.label ?? target.toUpperCase(), extensions: [target === 'code' ? '*' : target] }
        ])
        if (outcome.saved && outcome.path) announceSaved(outcome.path)
      } catch (error) {
        store.getState().reportError(error)
      } finally {
        store.getState().setBusy(null)
      }
    },
    [store]
  )

  const saveActive = useCallback(async (): Promise<void> => {
    const state = store.getState()

    if (state.route === 'editor' && state.editorDoc) {
      const doc = state.editorDoc
      // Save in place only when we can write the format we opened.
      const write = await writers()
      if (doc.source.path && write.canSaveInPlace(doc.source)) {
        state.setBusy({ label: state.t('msg.working'), progress: null })
        try {
          const result = await write.exportDocument(requestFor(doc, doc.source.format))
          await window.alcode.fs.write(doc.source.path, result.bytes)
          store.getState().markEditorSaved(doc.source.path)
          store.getState().notify({
            kind: 'success',
            title: store.getState().t('msg.saved'),
            message: doc.source.path
          })
        } catch (error) {
          store.getState().reportError(error)
        } finally {
          store.getState().setBusy(null)
        }
        return
      }
      // Read-only source formats fall back to the closest writable one.
      await exportEditorAs(fallbackTarget(doc))
      return
    }

    const doc = state.doc
    if (!doc) {
      state.notify({ kind: 'info', title: state.t('msg.noDocument') })
      return
    }
    if (doc.path) {
      // A protected file that has been edited is now decrypted; writing it back
      // in place would quietly replace the user's protected original with an
      // open one.
      if (doc.protectionDropped) {
        const accepted = await state.confirm({
          title: state.t('msg.protectionLost'),
          body: state.t('msg.protectionLostBody'),
          confirmLabel: state.t('msg.saveUnprotected'),
          danger: true
        })
        if (!accepted) {
          await savePdfAs()
          return
        }
      }
      state.setBusy({ label: state.t('msg.working'), progress: null })
      try {
        await window.alcode.fs.write(doc.path, doc.bytes)
        store.getState().markSaved(doc.path)
        store.getState().notify({
          kind: 'success',
          title: store.getState().t('msg.saved'),
          message: doc.path
        })
      } catch (error) {
        // ENOSPC, a revoked consent, a yanked drive: every one of these used to
        // reject an unawaited promise and leave the user believing it saved.
        store.getState().reportError(error)
      } finally {
        store.getState().setBusy(null)
      }
      return
    }
    await savePdfAs()
  }, [exportEditorAs, savePdfAs, store])

  const newDocument = useCallback(
    async (kind: 'rich' | 'sheet' | 'code', template?: string): Promise<void> => {
      const state = store.getState()
      const rightToLeft = state.settings.language === 'ar'
      const { emptyGrid } = await import('../lib/documents/sheets')
      const { markdownToHtml } = await import('../lib/markdown')

      if (kind === 'sheet') {
        state.openEditorDocument({
          name: 'workbook.xlsx',
          path: null,
          format: 'xlsx',
          kind: 'sheet',
          sheets: [{ name: 'Sheet1', rows: emptyGrid(24, 8) }],
          direction: rightToLeft ? 'rtl' : 'ltr',
          warnings: [],
          originalBytes: new Uint8Array()
        })
      } else if (kind === 'code') {
        state.openEditorDocument({
          name: 'untitled.txt',
          path: null,
          format: 'txt',
          kind: 'code',
          text: '',
          direction: 'ltr',
          warnings: [],
          originalBytes: new Uint8Array()
        })
      } else {
        state.openEditorDocument({
          name: 'document.docx',
          path: null,
          format: 'docx',
          kind: 'rich',
          html: sanitize(template ? markdownToHtml(template) : blankRichTemplate(rightToLeft)),
          direction: rightToLeft ? 'rtl' : 'ltr',
          warnings: [],
          originalBytes: new Uint8Array()
        })
      }
      state.navigate('editor')
    },
    [store]
  )

  const saveActiveAs = useCallback(async (): Promise<void> => {
    const state = store.getState()
    // "Save As" used to route into saveActive, which for a file with a path
    // went straight to an in-place write without ever showing a dialog.
    if (state.route === 'editor' && state.editorDoc) {
      const doc = state.editorDoc
      const { canSaveInPlace } = await writers()
      await exportEditorAs(canSaveInPlace(doc.source) ? doc.source.format : fallbackTarget(doc))
      return
    }
    await savePdfAs()
  }, [exportEditorAs, savePdfAs, store])

  return {
    openDialog,
    openPaths,
    saveActive,
    saveActiveAs,
    savePdfAs,
    exportEditorAs,
    newDocument,
    bridgeEditorToPdf
  }
}

interface ExportRequestShape {
  target: DocumentFormat
  name: string
  rightToLeft: boolean
  html?: string
  sheets?: EditorDoc['sheets']
  text?: string
  encoding?: string
  eol?: 'lf' | 'crlf'
}

function requestFor(doc: EditorDoc, target: DocumentFormat): ExportRequestShape {
  return {
    target,
    name: doc.source.name,
    rightToLeft: doc.direction === 'rtl',
    html: doc.source.kind === 'rich' || doc.source.kind === 'slides' ? doc.html : undefined,
    sheets: doc.source.kind === 'sheet' ? doc.sheets : undefined,
    text: doc.source.kind === 'code' ? doc.text : undefined,
    // Writing back to the same format keeps the encoding and line endings the
    // file arrived with; exporting to another format is a new file, so it gets
    // the modern default.
    encoding: target === doc.source.format ? doc.source.encoding : undefined,
    eol: target === doc.source.format ? doc.source.eol : undefined
  }
}

/** The best writable format for a document whose own format is read-only. */
function fallbackTarget(doc: EditorDoc): DocumentFormat {
  if (doc.source.kind === 'sheet') return 'xlsx'
  if (doc.source.kind === 'code') return 'txt'
  return 'docx'
}

function announceSaved(path: string): void {
  const state = useApp.getState()
  state.notify({
    kind: 'success',
    title: state.t('msg.saved'),
    message: path,
    action: { label: state.t('action.reveal'), run: () => void window.alcode.shell.reveal(path) }
  })
}

const WARNING_MESSAGES: Record<string, Parameters<ReturnType<typeof useApp.getState>['t']>[0]> = {
  'doc-text-only': 'msg.legacyDocNote',
  'pptx-layout-only': 'warn.pptx-layout-only',
  'pptx-images-dropped': 'warn.pptx-images-dropped',
  'unknown-format-as-text': 'msg.openedAsText',
  'sheet-truncated': 'msg.sheetTruncated',
  'epub-images-dropped': 'msg.epubImagesDropped'
}

function blankRichTemplate(rightToLeft: boolean): string {
  return rightToLeft
    ? '<h1>عنوان المستند</h1><p>ابدأ الكتابة هنا…</p>'
    : '<h1>Document title</h1><p>Start writing here…</p>'
}

export function documentBaseName(name: string): string {
  return stripExtension(name)
}
