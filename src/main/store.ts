import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { AppSettings, DEFAULT_SETTINGS, RecentFile } from '../shared/types'

/**
 * Minimal JSON-file persistence in the app's userData directory.
 * Intentionally dependency-free so the packaged app has no native modules.
 */
class JsonStore<T extends object> {
  private readonly file: string
  private cache: T

  constructor(fileName: string, fallback: T) {
    this.file = join(app.getPath('userData'), fileName)
    this.cache = fallback
    try {
      if (existsSync(this.file)) {
        this.cache = { ...fallback, ...JSON.parse(readFileSync(this.file, 'utf8')) }
      }
    } catch {
      this.cache = fallback
    }
  }

  get(): T {
    return this.cache
  }

  set(patch: Partial<T>): T {
    this.cache = { ...this.cache, ...patch }
    this.flush()
    return this.cache
  }

  replace(value: T): T {
    this.cache = value
    this.flush()
    return this.cache
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.cache, null, 2), 'utf8')
    } catch {
      /* settings are best-effort; never crash the app over them */
    }
  }
}

interface RecentsShape {
  items: RecentFile[]
}

/**
 * The last autosaved state of the document being edited.
 *
 * An editor with no recovery loses the afternoon to one crash or one power
 * cut, and the work it loses is exactly the work that was never saved — the
 * part the user would most mind. One slot is enough: the app edits one
 * document at a time.
 */
export interface DraftShape {
  /** Empty when there is nothing to recover. */
  name: string
  path: string | null
  format: string
  kind: string
  html: string
  text: string
  sheets: unknown[]
  direction: string
  savedAt: number
}

const EMPTY_DRAFT: DraftShape = {
  name: '',
  path: null,
  format: '',
  kind: '',
  html: '',
  text: '',
  sheets: [],
  direction: 'rtl',
  savedAt: 0
}

/**
 * Saved signatures. A signature is drawn once and used for years, so it lives
 * with the app rather than being redrawn — a mouse-drawn scrawl never comes out
 * the same twice, and a document signed with a different squiggle every time
 * looks exactly as unconvincing as it is.
 */
export interface SavedSignature {
  id: string
  name: string
  /** Trimmed PNG with a transparent background. */
  dataUrl: string
  createdAt: number
}

interface SignaturesShape {
  items: SavedSignature[]
}

let signaturesStore: JsonStore<SignaturesShape> | null = null
let settingsStore: JsonStore<AppSettings> | null = null
let recentsStore: JsonStore<RecentsShape> | null = null
let draftStore: JsonStore<DraftShape> | null = null

const THEMES: AppSettings['theme'][] = ['light', 'dark', 'system']
const LANGUAGES: AppSettings['language'][] = ['ar', 'en']

/**
 * Settings come off disk as whatever JSON happens to be in the file — a
 * hand-edited or half-written one included — and `theme` in particular is fed
 * straight to `nativeTheme.themeSource`, which throws on an unexpected value
 * and would take the app down at startup. Coerce at the boundary instead of
 * trusting the declared type.
 */
export function coerceSettings(raw: unknown): AppSettings {
  const source = (raw ?? {}) as Partial<Record<keyof AppSettings, unknown>>
  return {
    theme: THEMES.includes(source.theme as AppSettings['theme'])
      ? (source.theme as AppSettings['theme'])
      : DEFAULT_SETTINGS.theme,
    language: LANGUAGES.includes(source.language as AppSettings['language'])
      ? (source.language as AppSettings['language'])
      : DEFAULT_SETTINGS.language,
    accent: typeof source.accent === 'string' ? source.accent : DEFAULT_SETTINGS.accent,
    reduceMotion:
      typeof source.reduceMotion === 'boolean' ? source.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
    defaultExportDir:
      typeof source.defaultExportDir === 'string' ? source.defaultExportDir : null,
    rememberSession:
      typeof source.rememberSession === 'boolean'
        ? source.rememberSession
        : DEFAULT_SETTINGS.rememberSession,
    spellcheck:
      typeof source.spellcheck === 'boolean' ? source.spellcheck : DEFAULT_SETTINGS.spellcheck
  }
}

export function settings(): JsonStore<AppSettings> {
  if (!settingsStore) {
    settingsStore = new JsonStore<AppSettings>('settings.json', { ...DEFAULT_SETTINGS })
    settingsStore.replace(coerceSettings(settingsStore.get()))
  }
  return settingsStore
}

export function recents(): JsonStore<RecentsShape> {
  if (!recentsStore) recentsStore = new JsonStore<RecentsShape>('recent-files.json', { items: [] })
  return recentsStore
}

export function signatures(): JsonStore<SignaturesShape> {
  if (!signaturesStore) signaturesStore = new JsonStore<SignaturesShape>('signatures.json', { items: [] })
  return signaturesStore
}

/** Validated on read: a corrupt file must never stop the pad from opening. */
export function listSignatures(): SavedSignature[] {
  const items = signatures().get().items
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is SavedSignature =>
      Boolean(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.dataUrl === 'string' &&
      item.dataUrl.startsWith('data:image/')
  )
}

/** Caps the library: these are inline PNGs, and the file is read at startup. */
const SIGNATURE_LIMIT = 12

export function saveSignature(entry: SavedSignature): SavedSignature[] {
  const kept = listSignatures().filter((item) => item.id !== entry.id)
  const items = [entry, ...kept].slice(0, SIGNATURE_LIMIT)
  signatures().replace({ items })
  return items
}

export function deleteSignature(id: string): SavedSignature[] {
  const items = listSignatures().filter((item) => item.id !== id)
  signatures().replace({ items })
  return items
}

export function draft(): JsonStore<DraftShape> {
  if (!draftStore) draftStore = new JsonStore<DraftShape>('draft.json', { ...EMPTY_DRAFT })
  return draftStore
}

/**
 * Validated on read the way settings are: a truncated write — the very thing
 * a crash produces — must not stop the editor from opening.
 */
export function readDraft(): DraftShape | null {
  const value = draft().get()
  if (!value || typeof value.name !== 'string' || !value.name || typeof value.savedAt !== 'number') {
    return null
  }
  return {
    ...EMPTY_DRAFT,
    ...value,
    sheets: Array.isArray(value.sheets) ? value.sheets : [],
    html: typeof value.html === 'string' ? value.html : '',
    text: typeof value.text === 'string' ? value.text : ''
  }
}

export function clearDraft(): void {
  draft().replace({ ...EMPTY_DRAFT })
}

export function pushRecent(entry: RecentFile): RecentFile[] {
  const store = recents()
  const items = store.get().items.filter((item) => item.path !== entry.path)
  items.unshift(entry)
  store.replace({ items: items.slice(0, 24) })
  return store.get().items
}

export function clearRecents(): RecentFile[] {
  recents().replace({ items: [] })
  return []
}
