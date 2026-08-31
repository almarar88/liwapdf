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
  savePdfAs: () => Promise<void>
  exportEditorAs: (target: DocumentFormat) => Promise<void>
  newDocument: (kind: 'rich' | 'sheet' | 'code', template?: string) => Promise<void>
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
    const outcome = await saveBytes(doc.bytes, doc.name, FILTERS.pdf)
    if (outcome.saved && outcome.path) {
      state.markSaved(outcome.path)
      announceSaved(outcome.path)
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
      await window.alcode.fs.write(doc.path, doc.bytes)
      state.markSaved(doc.path)
      state.notify({ kind: 'success', title: state.t('msg.saved'), message: doc.path })
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

  return { openDialog, openPaths, saveActive, savePdfAs, exportEditorAs, newDocument }
}

interface ExportRequestShape {
  target: DocumentFormat
  name: string
  rightToLeft: boolean
  html?: string
  sheets?: EditorDoc['sheets']
  text?: string
}

function requestFor(doc: EditorDoc, target: DocumentFormat): ExportRequestShape {
  return {
    target,
    name: doc.source.name,
    rightToLeft: doc.direction === 'rtl',
    html: doc.source.kind === 'rich' || doc.source.kind === 'slides' ? doc.html : undefined,
    sheets: doc.source.kind === 'sheet' ? doc.sheets : undefined,
    text: doc.source.kind === 'code' ? doc.text : undefined
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
  'pptx-text-only': 'msg.slidesTextNote',
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
