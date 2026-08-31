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

export function settings(): JsonStore<AppSettings> {
  if (!settingsStore) settingsStore = new JsonStore<AppSettings>('settings.json', { ...DEFAULT_SETTINGS })
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
