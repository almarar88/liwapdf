import { supabase } from './client'
import { listAllPoems, purgePoem, readRecording, savePoem, saveRecording } from '../diwan/store'
import { listEntries, purgeEntry, saveEntry } from '../journal/store'
import { readMeta, writeMeta } from '../local/db'
import { styleOf, type Poem, type PoemStyle, type Verse, type VerseVersion } from '../diwan/types'
import type { JournalEntry } from '../journal/types'

/**
 * Keeping the phone and the cloud the same.
 *
 * The device is the source of truth and the cloud is its copy, so the
 * rules are few. Every record carries the moment it last changed; the
 * newer version wins, on either side. A record the cloud has not seen
 * since it changed is pushed; a record the cloud changed since the last
 * look is pulled. Deleting leaves a tombstone until the cloud has it.
 * Recordings travel separately, as files, only once their poem has.
 *
 * Nothing here retries or queues: a failed sync simply leaves the local
 * bookkeeping where it was, and the next sync does the same work again.
 */

export interface SyncReport {
  pushed: number
  pulled: number
  recordings: number
  errors: string[]
}

const PULL_POEMS = 'sync.poems.pulledAt'
const PULL_ENTRIES = 'sync.entries.pulledAt'
const EPOCH = '1970-01-01T00:00:00.000Z'
/** Clocks differ; pulling a little more than needed is harmless. */
const SKEW_MS = 5 * 60 * 1000

interface PoemRow {
  id: string
  user_id: string
  title: string
  form: string
  meter: string
  purpose: string
  rhyme: string
  occasion: string
  place: string
  said_on: string
  verses: Verse[]
  versions: VerseVersion[]
  has_recording: boolean
  recording_seconds: number
  recording_path: string
  style: Partial<PoemStyle>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface EntryRow {
  id: string
  user_id: string
  day: string
  title: string
  body: string
  mood: string
  tags: string[]
  place: string
  poem_ids: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0)
const iso = (value: number): string => new Date(value).toISOString()

export async function syncAll(userId: string): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, recordings: 0, errors: [] }
  await syncPoems(userId, report).catch((error) => report.errors.push(`poems: ${String(error)}`))
  await syncEntries(userId, report).catch((error) => report.errors.push(`journal: ${String(error)}`))
  return report
}

/* ------------------------------------------------------------------ poems */

async function syncPoems(userId: string, report: SyncReport): Promise<void> {
  const db = supabase()
  const startedAt = Date.now()
  const since = await readMeta<string>(PULL_POEMS, EPOCH)

  // Pull first, so a change made elsewhere is not overwritten by a stale push.
  const { data: remoteRows, error: pullError } = await db
    .from('poems')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
  if (pullError) throw pullError

  const local = new Map((await listAllPoems()).map((poem) => [poem.id, poem]))
  for (const row of (remoteRows ?? []) as PoemRow[]) {
    const mine = local.get(row.id)
    const remoteAt = ms(row.updated_at)
    if (mine && mine.updatedAt >= remoteAt) continue
    if (row.deleted_at) {
      if (mine) await purgePoem(row.id)
      local.delete(row.id)
      report.pulled += 1
      continue
    }
    const poem = poemFromRow(row, mine)
    await savePoem(poem)
    local.set(poem.id, poem)
    report.pulled += 1
    if (row.has_recording && row.recording_path && !(await readRecording(row.id))) {
      const { data, error } = await db.storage.from('recordings').download(row.recording_path)
      if (!error && data) {
        await saveRecording(row.id, data)
        report.recordings += 1
      }
    }
  }
  await writeMeta(PULL_POEMS, iso(startedAt - SKEW_MS))

  // Push what the cloud has not seen.
  for (const poem of local.values()) {
    if ((poem.syncedAt ?? 0) >= poem.updatedAt) continue
    const recordingPath = poem.hasRecording ? `${userId}/${poem.id}.webm` : ''
    const { error } = await db.from('poems').upsert(rowFromPoem(poem, userId, recordingPath))
    if (error) {
      report.errors.push(`poem ${poem.id}: ${error.message}`)
      continue
    }
    report.pushed += 1
    if (poem.deletedAt) {
      await db.storage.from('recordings').remove([`${userId}/${poem.id}.webm`]).catch(() => undefined)
      await purgePoem(poem.id)
      continue
    }
    await savePoem({ ...poem, syncedAt: poem.updatedAt })
  }

  // Recordings, once their poem is there.
  for (const poem of await listAllPoems()) {
    if (poem.deletedAt || !poem.hasRecording) continue
    if ((poem.recordingSyncedAt ?? 0) >= (poem.recordingAt ?? 0)) continue
    const blob = await readRecording(poem.id)
    if (!blob) continue
    const path = `${userId}/${poem.id}.webm`
    const { error } = await db.storage.from('recordings').upload(path, blob, { upsert: true, contentType: blob.type || 'audio/webm' })
    if (error) {
      report.errors.push(`recording ${poem.id}: ${error.message}`)
      continue
    }
    await db.from('poems').update({ recording_path: path, has_recording: true, recording_seconds: poem.recordingSeconds }).eq('id', poem.id)
    await savePoem({ ...poem, recordingSyncedAt: poem.recordingAt ?? Date.now() })
    report.recordings += 1
  }
}

function rowFromPoem(poem: Poem, userId: string, recordingPath: string): PoemRow {
  return {
    id: poem.id,
    user_id: userId,
    title: poem.title,
    form: poem.form,
    meter: poem.meter,
    purpose: poem.purpose,
    rhyme: poem.rhyme,
    occasion: poem.occasion,
    place: poem.place,
    said_on: poem.saidOn,
    verses: poem.verses,
    versions: poem.versions,
    has_recording: poem.hasRecording,
    recording_seconds: poem.recordingSeconds,
    recording_path: poem.hasRecording && (poem.recordingSyncedAt ?? 0) > 0 ? recordingPath : '',
    style: styleOf(poem),
    created_at: iso(poem.createdAt),
    updated_at: iso(poem.updatedAt),
    deleted_at: poem.deletedAt ? iso(poem.deletedAt) : null
  }
}

function poemFromRow(row: PoemRow, mine: Poem | undefined): Poem {
  const updatedAt = ms(row.updated_at)
  return {
    id: row.id,
    title: row.title ?? '',
    form: row.form === 'fusha' || row.form === 'free' ? row.form : 'nabati',
    meter: row.meter ?? '',
    purpose: row.purpose ?? '',
    rhyme: row.rhyme ?? '',
    occasion: row.occasion ?? '',
    place: row.place ?? '',
    saidOn: row.said_on ?? '',
    verses: Array.isArray(row.verses) ? row.verses : [],
    versions: Array.isArray(row.versions) ? row.versions : [],
    hasRecording: Boolean(row.has_recording),
    recordingSeconds: row.recording_seconds ?? 0,
    style: styleOf({ style: row.style }),
    createdAt: ms(row.created_at) || updatedAt,
    updatedAt,
    deletedAt: null,
    // Whatever recording the cloud holds is, by definition, synced.
    recordingAt: mine?.recordingAt ?? updatedAt,
    recordingSyncedAt: row.has_recording ? updatedAt : mine?.recordingSyncedAt,
    syncedAt: updatedAt
  }
}

/* ---------------------------------------------------------------- journal */

async function syncEntries(userId: string, report: SyncReport): Promise<void> {
  const db = supabase()
  const startedAt = Date.now()
  const since = await readMeta<string>(PULL_ENTRIES, EPOCH)

  const { data: remoteRows, error: pullError } = await db
    .from('journal_entries')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
  if (pullError) throw pullError

  const local = new Map((await listEntries()).map((entry) => [entry.id, entry]))
  for (const row of (remoteRows ?? []) as EntryRow[]) {
    const mine = local.get(row.id)
    const remoteAt = ms(row.updated_at)
    if (mine && mine.updatedAt >= remoteAt) continue
    if (row.deleted_at) {
      if (mine) await purgeEntry(row.id)
      local.delete(row.id)
      report.pulled += 1
      continue
    }
    const entry: JournalEntry = {
      id: row.id,
      day: row.day,
      title: row.title ?? '',
      body: row.body ?? '',
      mood: row.mood ?? '',
      tags: Array.isArray(row.tags) ? row.tags : [],
      place: row.place ?? '',
      poemIds: Array.isArray(row.poem_ids) ? row.poem_ids : [],
      createdAt: ms(row.created_at) || remoteAt,
      updatedAt: remoteAt,
      deletedAt: null,
      syncedAt: remoteAt
    }
    await saveEntry(entry)
    local.set(entry.id, entry)
    report.pulled += 1
  }
  await writeMeta(PULL_ENTRIES, iso(startedAt - SKEW_MS))

  for (const entry of local.values()) {
    if ((entry.syncedAt ?? 0) >= entry.updatedAt) continue
    const row: EntryRow = {
      id: entry.id,
      user_id: userId,
      day: entry.day,
      title: entry.title,
      body: entry.body,
      mood: entry.mood,
      tags: entry.tags,
      place: entry.place,
      poem_ids: entry.poemIds,
      created_at: iso(entry.createdAt),
      updated_at: iso(entry.updatedAt),
      deleted_at: entry.deletedAt ? iso(entry.deletedAt) : null
    }
    const { error } = await db.from('journal_entries').upsert(row)
    if (error) {
      report.errors.push(`entry ${entry.id}: ${error.message}`)
      continue
    }
    report.pushed += 1
    if (entry.deletedAt) await purgeEntry(entry.id)
    else await saveEntry({ ...entry, syncedAt: entry.updatedAt })
  }
}

/** Forgets what was pulled, so the next sync re-reads everything. Used on sign-in. */
export async function resetSyncCursor(): Promise<void> {
  await writeMeta(PULL_POEMS, EPOCH)
  await writeMeta(PULL_ENTRIES, EPOCH)
}
