import type { Poem } from './types'

/**
 * Where the poems live: IndexedDB, in the app's own origin.
 *
 * The desktop keeps settings in a JSON file through the main process and the
 * phone keeps them in Preferences, but a diwan is different in two ways that
 * make both a poor fit: it can hold hundreds of poems, and it holds audio —
 * a recorded recitation is megabytes, and JSON-encoding it into a settings
 * file would be its own bug. IndexedDB stores blobs natively, is the same
 * API in Electron and in Android's WebView, and needs no native code at all.
 */

const DB_NAME = 'alcode-diwan'
const DB_VERSION = 1
const POEMS = 'poems'
const RECORDINGS = 'recordings'

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb-unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(POEMS)) {
        const store = db.createObjectStore(POEMS, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS)
    }
    request.onsuccess = () => {
      const db = request.result
      // If the database is deleted or upgraded underneath us, reopen next time.
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error('indexeddb-open-failed'))
    }
    request.onblocked = () => {
      opening = null
      reject(new Error('indexeddb-blocked'))
    }
  })
  return opening
}

function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = work(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('indexeddb-request-failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb-aborted'))
      })
  )
}

/** Every poem, newest first. */
export async function listPoems(): Promise<Poem[]> {
  const all = await run<Poem[]>(POEMS, 'readonly', (store) => store.getAll())
  return all
    .filter((poem): poem is Poem => Boolean(poem && typeof poem.id === 'string' && Array.isArray(poem.verses)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function savePoem(poem: Poem): Promise<void> {
  await run(POEMS, 'readwrite', (store) => store.put(poem))
}

export async function deletePoem(id: string): Promise<void> {
  await run(POEMS, 'readwrite', (store) => store.delete(id))
  await run(RECORDINGS, 'readwrite', (store) => store.delete(id)).catch(() => undefined)
}

export async function saveRecording(id: string, blob: Blob): Promise<void> {
  await run(RECORDINGS, 'readwrite', (store) => store.put(blob, id))
}

export async function readRecording(id: string): Promise<Blob | null> {
  const value = await run<Blob | undefined>(RECORDINGS, 'readonly', (store) => store.get(id))
  return value instanceof Blob ? value : null
}

export async function deleteRecording(id: string): Promise<void> {
  await run(RECORDINGS, 'readwrite', (store) => store.delete(id))
}

/**
 * Everything, as one JSON document: the poems in full, without the audio.
 * A backup a poet can keep in Drive and bring back on a new phone.
 */
export function serializeDiwan(poems: Poem[]): string {
  return JSON.stringify({ app: 'alcode-editor', kind: 'diwan', version: 1, poems }, null, 2)
}

export function parseDiwan(json: string): Poem[] {
  const parsed = JSON.parse(json) as { kind?: string; poems?: unknown }
  if (parsed.kind !== 'diwan' || !Array.isArray(parsed.poems)) throw new Error('not-a-diwan')
  return parsed.poems.filter(
    (poem): poem is Poem =>
      Boolean(poem) && typeof (poem as Poem).id === 'string' && Array.isArray((poem as Poem).verses)
  )
}
