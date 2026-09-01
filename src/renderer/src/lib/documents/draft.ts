import type { LoadedDocument } from './read'
import type { SheetData } from './sheets'
import type { DocumentFormat, DocumentKind } from './formats'

/**
 * Crash recovery for the document editor.
 *
 * Everything else the app writes goes to a file the user chose. What the
 * editor holds between saves exists only in memory, and it is exactly the work
 * a crash or a power cut takes — the part not yet written down. A sidecar in
 * the app's own data directory costs nothing and turns that loss into a prompt.
 *
 * Only the edited content is kept, never the original bytes: a draft is for
 * getting the text back, not for reconstructing the file, and copying a 90 MB
 * source into userData every few seconds would be its own bug.
 */
export interface Draft {
  name: string
  path: string | null
  format: string
  kind: string
  html: string
  text: string
  sheets: SheetData[]
  direction: string
  savedAt: number
}

export interface DraftSnapshot {
  name: string
  path: string | null
  format: DocumentFormat
  kind: DocumentKind
  html: string
  text: string
  sheets: SheetData[]
  direction: 'rtl' | 'ltr'
}

export async function saveDraft(snapshot: DraftSnapshot): Promise<void> {
  const draft: Draft = {
    name: snapshot.name,
    path: snapshot.path,
    format: snapshot.format,
    kind: snapshot.kind,
    html: snapshot.html,
    text: snapshot.text,
    sheets: snapshot.sheets,
    direction: snapshot.direction,
    savedAt: Date.now()
  }
  await window.alcode.draft.save(draft).catch(() => undefined)
}

export async function clearDraft(): Promise<void> {
  await window.alcode.draft.clear().catch(() => undefined)
}

/** The recoverable draft, or null when there is nothing worth offering. */
export async function readDraft(): Promise<Draft | null> {
  try {
    const raw = (await window.alcode.draft.read()) as Draft | null
    if (!raw || !raw.name) return null
    const hasContent =
      Boolean(raw.html?.trim()) || Boolean(raw.text?.trim()) || (raw.sheets?.length ?? 0) > 0
    return hasContent ? raw : null
  } catch {
    return null
  }
}

/**
 * Rebuilds a document the editor can open from a recovered draft.
 *
 * `originalBytes` is deliberately empty: the draft never held them, and a
 * recovered document must not be able to save in place over a file whose
 * original content the app can no longer see.
 */
export function documentFromDraft(draft: Draft): LoadedDocument {
  return {
    name: draft.name,
    path: null,
    format: draft.format as DocumentFormat,
    kind: draft.kind as DocumentKind,
    html: draft.html,
    text: draft.text,
    sheets: draft.sheets,
    direction: draft.direction === 'ltr' ? 'ltr' : 'rtl',
    warnings: [],
    originalBytes: new Uint8Array(),
    truncated: true
  }
}
