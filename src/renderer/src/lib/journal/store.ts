import { STORE_ENTRIES, run } from '../local/db'
import type { JournalEntry } from './types'

export async function listEntries(): Promise<JournalEntry[]> {
  const all = await run<JournalEntry[]>(STORE_ENTRIES, 'readonly', (store) => store.getAll())
  return all
    .filter((entry): entry is JournalEntry => Boolean(entry && typeof entry.id === 'string' && typeof entry.day === 'string'))
    .sort((a, b) => (a.day === b.day ? b.updatedAt - a.updatedAt : b.day.localeCompare(a.day)))
}

export async function saveEntry(entry: JournalEntry): Promise<void> {
  await run(STORE_ENTRIES, 'readwrite', (store) => store.put(entry))
}

export async function purgeEntry(id: string): Promise<void> {
  await run(STORE_ENTRIES, 'readwrite', (store) => store.delete(id))
}
