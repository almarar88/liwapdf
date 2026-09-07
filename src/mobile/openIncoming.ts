import { useApp } from '../renderer/src/store/app'

/**
 * Opens a document that arrived from outside the app — shared in, or tapped
 * in a file manager — through exactly the path a file the user picked takes.
 *
 * The routing (PDF to the viewer, everything else to the editor) already
 * lives in the app's own open logic, so this reuses it rather than making a
 * second, quietly different decision.
 */
export async function openAnyBytes(name: string, bytes: Uint8Array): Promise<void> {
  const state = useApp.getState()
  state.setBusy({ label: state.t('msg.loading'), progress: null })
  try {
    const { readDocument } = await import('../renderer/src/lib/documents/read')
    const loaded = await readDocument(name, bytes, null)
    if (loaded.format === 'pdf') {
      const opened = await useApp.getState().openPdfBytes(name, bytes, null)
      if (opened) useApp.getState().navigate('viewer')
      return
    }
    useApp.getState().openEditorDocument(loaded)
    useApp.getState().navigate('editor')
  } finally {
    useApp.getState().setBusy(null)
  }
}
