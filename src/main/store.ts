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

let settingsStore: JsonStore<AppSettings> | null = null
let recentsStore: JsonStore<RecentsShape> | null = null

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
        : DEFAULT_SETTINGS.rememberSession
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
