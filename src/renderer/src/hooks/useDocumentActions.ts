import { useCallback } from 'react'
import { useApp } from '../store/app'
import { FILTERS, pickFiles, saveBytes, bytesToText } from '../lib/files'
import { docxToHtml } from '../lib/docx/read'
import { markdownToHtml } from '../lib/markdown'
import { htmlToDocx } from '../lib/docx/write'
import { htmlToPdf } from '../lib/convert'
import { extensionOf, needsComplexShaping, stripExtension } from '../lib/format'

export interface DocumentActions {
  openDialog: () => Promise<void>
  openPaths: (paths: string[]) => Promise<void>
  saveActive: () => Promise<void>
  savePdfAs: () => Promise<void>
  saveWordAs: (format: 'docx' | 'pdf' | 'html' | 'txt') => Promise<void>
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
      const extension = extensionOf(name)

      if (extension === 'pdf') {
        const opened = await state.openPdfBytes(name, bytes, path)
        if (opened) state.navigate('viewer')
        return
      }

      if (extension === 'docx' || extension === 'doc') {
        state.setBusy({ label: state.t('msg.loading'), progress: null })
        try {
          const { html } = await docxToHtml(bytes)
          state.setWordDoc({ name, path, html, dirty: false })
          state.navigate('word')
        } finally {
          state.setBusy(null)
        }
        return
      }

      if (['txt', 'md', 'markdown', 'html', 'htm'].includes(extension)) {
        const text = bytesToText(bytes)
        const html =
          extension === 'html' || extension === 'htm'
            ? extractBody(text)
            : extension === 'txt'
              ? text
                  .split(/\n{2,}/)
                  .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
                  .join('')
              : markdownToHtml(text)
        state.setWordDoc({ name, path, html, dirty: false })
        state.navigate('word')
        return
      }

      state.notify({ kind: 'error', title: state.t('msg.unsupported'), message: name })
    },
    [store]
  )

  const openPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      const state = store.getState()
      for (const path of paths) {
        try {
          const file = await window.alcode.fs.read(path)
          await openBytes(file.name, file.data, file.path)
        } catch (error) {
          state.reportError(error)
        }
      }
      await store.getState().refreshRecents()
    },
    [openBytes, store]
  )

  const openDialog = useCallback(async (): Promise<void> => {
    const files = await pickFiles(FILTERS.documents, true)
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
      state.notify({
        kind: 'success',
        title: state.t('msg.saved'),
        message: outcome.path,
        action: {
          label: state.t('action.reveal'),
          run: () => void window.alcode.shell.reveal(outcome.path!)
        }
      })
    }
  }, [store])

  const saveWordAs = useCallback(
    async (format: 'docx' | 'pdf' | 'html' | 'txt'): Promise<void> => {
      const state = store.getState()
      const doc = state.wordDoc
      if (!doc) {
        state.notify({ kind: 'info', title: state.t('msg.noDocument') })
        return
      }
      const base = stripExtension(doc.name)
      const rightToLeft = state.settings.language === 'ar' || needsComplexShaping(doc.html.slice(0, 3000))

      state.setBusy({ label: state.t('msg.working'), progress: null })
      try {
        if (format === 'docx') {
          const bytes = await htmlToDocx(doc.html, { title: base, rightToLeft })
          const outcome = await saveBytes(bytes, `${base}.docx`, FILTERS.word)
          if (outcome.saved && outcome.path) {
            state.markWordSaved(outcome.path, `${base}.docx`)
            announce(outcome.path)
          }
        } else if (format === 'pdf') {
          const bytes = await htmlToPdf(doc.html, { rightToLeft, title: base, pageSize: 'A4' })
          const outcome = await saveBytes(bytes, `${base}.pdf`, FILTERS.pdf)
          if (outcome.saved && outcome.path) announce(outcome.path)
        } else if (format === 'html') {
          const outcome = await window.alcode.dialog.save({
            defaultName: `${base}.html`,
            filters: FILTERS.html as unknown as { name: string; extensions: string[] }[]
          })
          if (!outcome.canceled && outcome.path) {
            await window.alcode.fs.writeText(
              outcome.path,
              `<!doctype html><html lang="${rightToLeft ? 'ar' : 'en'}" dir="${
                rightToLeft ? 'rtl' : 'ltr'
              }"><meta charset="utf-8"><title>${base}</title><body>${doc.html}</body></html>`
            )
            announce(outcome.path)
          }
        } else {
          const container = document.createElement('div')
          container.innerHTML = doc.html
          const outcome = await window.alcode.dialog.save({
            defaultName: `${base}.txt`,
            filters: FILTERS.text as unknown as { name: string; extensions: string[] }[]
          })
          if (!outcome.canceled && outcome.path) {
            await window.alcode.fs.writeText(outcome.path, container.innerText)
            announce(outcome.path)
          }
        }
      } catch (error) {
        state.reportError(error)
      } finally {
        state.setBusy(null)
      }

      function announce(path: string): void {
        state.notify({
          kind: 'success',
          title: state.t('msg.saved'),
          message: path,
          action: {
            label: state.t('action.reveal'),
            run: () => void window.alcode.shell.reveal(path)
          }
        })
      }
    },
    [store]
  )

  const saveActive = useCallback(async (): Promise<void> => {
    const state = store.getState()
    if (state.route === 'word' && state.wordDoc) {
      const doc = state.wordDoc
      if (doc.path && doc.path.toLowerCase().endsWith('.docx')) {
        const rightToLeft =
          state.settings.language === 'ar' || needsComplexShaping(doc.html.slice(0, 3000))
        state.setBusy({ label: state.t('msg.working'), progress: null })
        try {
          const bytes = await htmlToDocx(doc.html, { title: stripExtension(doc.name), rightToLeft })
          await window.alcode.fs.write(doc.path, bytes)
          state.markWordSaved(doc.path)
          state.notify({ kind: 'success', title: state.t('msg.saved'), message: doc.path })
        } catch (error) {
          state.reportError(error)
        } finally {
          state.setBusy(null)
        }
        return
      }
      await saveWordAs('docx')
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
  }, [savePdfAs, saveWordAs, store])

  return { openDialog, openPaths, saveActive, savePdfAs, saveWordAs }
}

function extractBody(html: string): string {
  const match = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return match ? match[1] : html
}
