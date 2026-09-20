/**
 * The one local database: IndexedDB, in the app's own origin.
 *
 * Journal entries, poems and recordings all live here, on the device, and
 * they are the source of truth the screens read from. The cloud is a copy
 * of this — kept by the sync layer when the person is signed in — never the
 * other way round, so the app works exactly the same on a plane.
 */

const DB_NAME = 'alcode-diwan'
const DB_VERSION = 2

export const STORE_POEMS = 'poems'
export const STORE_RECORDINGS = 'recordings'
export const STORE_ENTRIES = 'entries'
export const STORE_META = 'meta'

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
      if (!db.objectStoreNames.contains(STORE_POEMS)) {
        db.createObjectStore(STORE_POEMS, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) db.createObjectStore(STORE_RECORDINGS)
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const entries = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' })
        entries.createIndex('day', 'day')
        entries.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
    }
    request.onsuccess = () => {
      const db = request.result
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

export function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const value = await run<T | undefined>(STORE_META, 'readonly', (store) => store.get(key)).catch(() => undefined)
  return value === undefined ? fallback : value
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await run(STORE_META, 'readwrite', (store) => store.put(value, key))
}
