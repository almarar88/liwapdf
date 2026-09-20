import { STORE_POEMS, STORE_RECORDINGS, run } from '../local/db'
import type { Poem } from './types'

/**
 * The poems on this device. Deleting is a tombstone rather than a removal,
 * so a poem deleted on the phone disappears from the laptop too once both
 * have synced; the sync layer purges the row after the cloud has it.
 */

/** Every living poem, newest first. */
export async function listPoems(): Promise<Poem[]> {
  const all = await listAllPoems()
  return all.filter((poem) => !poem.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Living and deleted alike, for the sync layer. */
export async function listAllPoems(): Promise<Poem[]> {
  const all = await run<Poem[]>(STORE_POEMS, 'readonly', (store) => store.getAll())
  return all.filter((poem): poem is Poem => Boolean(poem && typeof poem.id === 'string' && Array.isArray(poem.verses)))
}

export async function savePoem(poem: Poem): Promise<void> {
  await run(STORE_POEMS, 'readwrite', (store) => store.put(poem))
}

export async function purgePoem(id: string): Promise<void> {
  await run(STORE_POEMS, 'readwrite', (store) => store.delete(id))
  await run(STORE_RECORDINGS, 'readwrite', (store) => store.delete(id)).catch(() => undefined)
}

export async function saveRecording(id: string, blob: Blob): Promise<void> {
  await run(STORE_RECORDINGS, 'readwrite', (store) => store.put(blob, id))
}

export async function readRecording(id: string): Promise<Blob | null> {
  const value = await run<Blob | undefined>(STORE_RECORDINGS, 'readonly', (store) => store.get(id))
  return value instanceof Blob ? value : null
}

export async function deleteRecording(id: string): Promise<void> {
  await run(STORE_RECORDINGS, 'readwrite', (store) => store.delete(id))
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
